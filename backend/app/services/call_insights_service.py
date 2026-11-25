"""
Call intelligence — team-level numbers built from AI call reviews and CRM records.

Two kinds of numbers are kept apart throughout:
  * Call QUALITY: AI scores (with manager corrections applied where they exist).
  * Business OUTCOME: appointments and showroom arrivals, read from CRM tables only.

Every rate is returned with its numerator and denominator so small samples are
visible, and each denominator is the population the rate actually applies to:
  appointment-setting rate = calls with an appointment booked / reviewed calls linked to a lead
  show rate                = appointments where the customer arrived / appointments whose
                             outcome is known (arrived or no-show); still-upcoming ones are excluded
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.appointment import Appointment
from app.models.call_log import CallLog
from app.models.call_review import (
    CallEvaluation,
    CallEvaluationFeedback,
    CallReview,
    CallReviewStatus,
    CallRubric,
    FeedbackItemType,
    FeedbackVerdict,
)
from app.models.dealership import Dealership
from app.models.user import User
from app.services.call_evaluation_service import OBJECTION_CATEGORIES, compute_overall_score

APPOINTMENT_ATTRIBUTION_WINDOW = timedelta(hours=2)
MAX_CALLS = 5000
LOW_SCORE = 50
HIGH_SCORE = 80

SHOWED_STATUSES = {"arrived", "in_showroom", "in_progress", "completed", "sold"}
NO_SHOW_STATUSES = {"no_show"}


# ------------------------------------------------------- shared helpers ----

def _status_value(status: Any) -> str:
    return status.value if hasattr(status, "value") else str(status)


def attribute_appointment(
    call_started_at: Optional[datetime],
    call_ended_at: Optional[datetime],
    lead_appointments: Iterable[Any],
) -> Optional[Any]:
    """
    The appointment booked on this call, if any: the first one created for the
    lead between the call starting and shortly after it ended.
    """
    if call_started_at is None:
        return None
    window_end = (call_ended_at or call_started_at) + APPOINTMENT_ATTRIBUTION_WINDOW
    candidates = [a for a in lead_appointments if call_started_at <= a.created_at <= window_end]
    return min(candidates, key=lambda a: a.created_at) if candidates else None


def apply_score_corrections(
    category_scores: List[Dict[str, Any]], corrections: Dict[str, int]
) -> Optional[float]:
    """Overall score with manager-corrected category scores, or None when there are no corrections."""
    relevant = {k: v for k, v in corrections.items() if any(c["key"] == k for c in category_scores)}
    if not relevant:
        return None
    adjusted = [
        {**c, "score": relevant[c["key"]], "not_applicable": False} if c["key"] in relevant else c
        for c in category_scores
    ]
    return compute_overall_score(adjusted)


def _rate(numerator: int, denominator: int) -> Dict[str, Any]:
    return {
        "numerator": numerator,
        "denominator": denominator,
        "rate": round(numerator / denominator, 4) if denominator else None,
    }


def _avg(values: List[float]) -> Optional[float]:
    return round(mean(values), 1) if values else None


# ------------------------------------------------------------ pure maths ----

def summarise(calls: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Headline numbers for a set of reviewed calls. Each call is a dict:
      {score, lead_id, appointment: None | {id, status, scheduled_at}, ...}
    """
    scores = [c["score"] for c in calls if c.get("score") is not None]
    with_lead = [c for c in calls if c.get("lead_id")]
    booked = [c for c in with_lead if c.get("appointment")]

    # An appointment is one visit even if two calls point at it
    appointments = {c["appointment"]["id"]: c["appointment"] for c in booked}
    showed = sum(1 for a in appointments.values() if a["status"] in SHOWED_STATUSES)
    no_show = sum(1 for a in appointments.values() if a["status"] in NO_SHOW_STATUSES)

    return {
        "calls_reviewed": len(calls),
        "calls_scored": len(scores),
        "average_score": _avg(scores),
        "appointment_rate": _rate(len(booked), len(with_lead)),
        "calls_without_lead": len(calls) - len(with_lead),
        "show_rate": _rate(showed, showed + no_show),
        "appointments_outcome_pending": len(appointments) - showed - no_show,
    }


def _criteria_breakdown(calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    for call in calls:
        for c in call.get("category_scores") or []:
            if c.get("not_applicable") or c.get("score") is None:
                continue
            entry = by_key.setdefault(c["key"], {"key": c["key"], "name": c["name"], "scores": []})
            entry["name"] = c["name"]  # latest wording wins
            entry["scores"].append(c["score"])
    out = []
    for entry in by_key.values():
        scores = entry.pop("scores")
        out.append(
            {
                **entry,
                "calls": len(scores),
                "average_score": _avg(scores),
                "low_count": sum(1 for s in scores if s < LOW_SCORE),
                "high_count": sum(1 for s in scores if s >= HIGH_SCORE),
            }
        )
    return out


def _objection_breakdown(calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counts: Dict[str, Dict[str, int]] = defaultdict(lambda: {"calls": 0, "unresolved": 0})
    for call in calls:
        seen = {}
        for o in call.get("objections") or []:
            category = o.get("category") if o.get("category") in OBJECTION_CATEGORIES else "other"
            # Count a category once per call; unresolved if any instance was left unresolved
            seen[category] = seen.get(category, False) or not o.get("resolved")
        for category, unresolved in seen.items():
            counts[category]["calls"] += 1
            counts[category]["unresolved"] += 1 if unresolved else 0
    out = [
        {"category": k, "label": OBJECTION_CATEGORIES[k], **v}
        for k, v in counts.items()
    ]
    out.sort(key=lambda x: (-x["calls"], x["label"]))
    return out


MISSED_ASK_KEY = "missed_the_ask"


def top_fix(result: Dict[str, Any], category_scores: List[Dict[str, Any]], rejected: Iterable[tuple] = ()) -> Optional[Dict[str, Any]]:
    """
    The single thing shown in a call's "Fix this" tile, and the group it is
    counted under in Recurring issues. Priority: a missed chance to ask for the
    appointment, then an objection left unresolved, then the first improvement.
    Items a manager marked as not accurate are skipped. `rejected` holds
    (item_type, item_key) pairs.
    """
    rejected = set(rejected)
    for i, m in enumerate(result.get("missed_appointment_opportunities") or []):
        if (FeedbackItemType.MISSED_OPPORTUNITY.value, str(i)) not in rejected:
            return {"key": MISSED_ASK_KEY, "label": "Missed the ask for an appointment",
                    "tag": "Missed the ask", "text": m.get("text") or ""}
    for i, o in enumerate(result.get("customer_objections") or []):
        if not o.get("resolved") and (FeedbackItemType.OBJECTION.value, str(i)) not in rejected:
            category = o.get("category") if o.get("category") in OBJECTION_CATEGORIES else "other"
            return {"key": f"objection_left_open:{category}",
                    "label": f"Objection left open: {OBJECTION_CATEGORIES[category]}",
                    "tag": "Objection left open", "text": o.get("objection") or ""}
    names = {c.get("key"): c.get("name") for c in category_scores or []}
    for i, imp in enumerate(result.get("improvements") or []):
        if (FeedbackItemType.IMPROVEMENT.value, str(i)) not in rejected:
            criterion = imp.get("criterion")
            if criterion in names:
                return {"key": f"criterion:{criterion}", "label": f"Improve: {names[criterion]}", "tag": None,
                        "text": imp.get("text") or ""}
            return {"key": "other", "label": "Other improvements", "tag": None, "text": imp.get("text") or ""}
    return None


def _hidden_objection_breakdown(calls: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    The AI's guesses at unstated objections. Kept apart from stated objections:
    these are guesses, and guesses a manager marked wrong are already excluded.
    """
    counts: Dict[str, Dict[str, int]] = defaultdict(lambda: {"calls": 0, "medium_or_high": 0, "stated_too": 0})
    with_guess = 0
    for call in calls:
        hidden = call.get("hidden_objection")
        if not hidden:
            continue
        with_guess += 1
        category = hidden.get("category") if hidden.get("category") in OBJECTION_CATEGORIES else "other"
        counts[category]["calls"] += 1
        if hidden.get("confidence") in ("medium", "high"):
            counts[category]["medium_or_high"] += 1
        stated = {o.get("category") for o in call.get("objections") or []}
        if category in stated:
            counts[category]["stated_too"] += 1
    items = [{"category": k, "label": OBJECTION_CATEGORIES[k], **v} for k, v in counts.items()]
    items.sort(key=lambda x: (-x["calls"], x["label"]))
    return {"calls_with_guess": with_guess, "items": items}


def _group(calls: List[Dict[str, Any]], key: str, names: Dict[Any, str]) -> List[Dict[str, Any]]:
    groups: Dict[Any, List[Dict[str, Any]]] = defaultdict(list)
    for c in calls:
        groups[c.get(key)].append(c)
    out = []
    for group_id, members in groups.items():
        s = summarise(members)
        out.append(
            {
                "id": str(group_id) if group_id else None,
                "name": names.get(group_id) or "Unassigned",
                "calls_reviewed": s["calls_reviewed"],
                "average_score": s["average_score"],
                "appointment_rate": s["appointment_rate"],
            }
        )
    out.sort(key=lambda x: (-(x["calls_reviewed"]), x["name"]))
    return out


def _trend(calls: List[Dict[str, Any]], start: datetime, end: datetime) -> Dict[str, Any]:
    weekly = (end - start) > timedelta(days=45)

    def bucket(dt: datetime) -> str:
        d = dt.date()
        if weekly:
            d = d - timedelta(days=d.weekday())  # Monday of that week
        return d.isoformat()

    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in calls:
        if c.get("started_at"):
            groups[bucket(c["started_at"])].append(c)
    points = []
    for day in sorted(groups):
        s = summarise(groups[day])
        points.append(
            {
                "date": day,
                "calls_reviewed": s["calls_reviewed"],
                "average_score": s["average_score"],
                "appointment_rate": s["appointment_rate"],
            }
        )
    return {"bucket": "week" if weekly else "day", "points": points}


def _focus(summary: Dict[str, Any], previous: Dict[str, Any], criteria: List[Dict[str, Any]],
           objections: List[Dict[str, Any]], missed: Dict[str, int]) -> List[Dict[str, str]]:
    """Plain-language pointers computed from the numbers above (no AI involved)."""
    out: List[Dict[str, str]] = []
    scored = [c for c in criteria if c["average_score"] is not None and c["calls"] >= 3]
    if scored:
        weakest = min(scored, key=lambda c: c["average_score"])
        out.append(
            {
                "title": f"Weakest area: {weakest['name']}",
                "detail": f"Average {weakest['average_score']:g} across {weakest['calls']} calls; "
                          f"{weakest['low_count']} scored below {LOW_SCORE}.",
            }
        )
    if objections:
        top = objections[0]
        out.append(
            {
                "title": f"Most common objection: {top['label']}",
                "detail": f"Raised on {top['calls']} calls and left unresolved on {top['unresolved']}.",
            }
        )
    if missed["calls"]:
        out.append(
            {
                "title": "Missed chances to ask for the visit",
                "detail": f"{missed['calls']} of {summary['calls_reviewed']} calls had at least one moment "
                          f"where the rep could have asked for an appointment and did not.",
            }
        )
    if summary["average_score"] is not None and previous["average_score"] is not None:
        diff = round(summary["average_score"] - previous["average_score"], 1)
        direction = "up" if diff > 0 else "down" if diff < 0 else "unchanged"
        out.append(
            {
                "title": f"Call quality is {direction} on the previous period",
                "detail": f"Average score {summary['average_score']:g} now vs {previous['average_score']:g} before "
                          f"({summary['calls_scored']} vs {previous['calls_scored']} calls).",
            }
        )
    return out


def build_dashboard(
    calls: List[Dict[str, Any]],
    previous_calls: List[Dict[str, Any]],
    start: datetime,
    end: datetime,
    rep_names: Dict[Any, str],
    dealership_names: Dict[Any, str],
) -> Dict[str, Any]:
    summary = summarise(calls)
    previous = summarise(previous_calls)
    criteria = _criteria_breakdown(calls)
    objections = _objection_breakdown(calls)
    missed = {
        "calls": sum(1 for c in calls if c.get("missed_opportunities")),
        "total": sum(c.get("missed_opportunities") or 0 for c in calls),
    }
    return {
        "summary": summary,
        "previous_summary": previous,
        "trend": _trend(calls, start, end),
        "criteria": sorted(criteria, key=lambda c: (c["average_score"] is None, c["average_score"] or 0)),
        "common_mistakes": sorted(
            [c for c in criteria if c["low_count"]], key=lambda c: (-c["low_count"], c["name"])
        )[:5],
        "successful_behaviors": sorted(
            [c for c in criteria if c["high_count"]], key=lambda c: (-c["high_count"], c["name"])
        )[:5],
        "objections": objections,
        "hidden_objections": _hidden_objection_breakdown(calls),
        "missed_opportunities": missed,
        "by_rep": _group(calls, "rep_user_id", rep_names),
        "by_dealership": _group(calls, "dealership_id", dealership_names),
        "focus": _focus(summary, previous, criteria, objections, missed),
        "thresholds": {"low": LOW_SCORE, "high": HIGH_SCORE},
    }


# ---------------------------------------------------------------- loading ----

async def load_calls(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    rep_user_id: Optional[UUID] = None,
    dealership_id: Optional[UUID] = None,
) -> List[Dict[str, Any]]:
    """Completed reviews whose call started in [start, end), with CRM appointment outcome attached."""
    conditions = [
        CallReview.status == CallReviewStatus.COMPLETED.value,
        CallReview.call_started_at >= start,
        CallReview.call_started_at < end,
        CallEvaluation.is_current.is_(True),
    ]
    if rep_user_id:
        conditions.append(CallReview.rep_user_id == rep_user_id)
    if dealership_id:
        conditions.append(CallReview.dealership_id == dealership_id)

    result = await db.execute(
        select(CallReview, CallEvaluation, CallLog.ended_at)
        .join(CallEvaluation, CallEvaluation.review_id == CallReview.id)
        .outerjoin(CallLog, CallLog.id == CallReview.call_log_id)
        .where(*conditions)
        .order_by(CallReview.call_started_at.desc())
        .limit(MAX_CALLS)
    )
    rows = result.all()
    if not rows:
        return []

    lead_ids = {r.lead_id for r, _, _ in rows if r.lead_id}
    appointments: Dict[Any, List[Appointment]] = defaultdict(list)
    if lead_ids:
        appt_result = await db.execute(
            select(Appointment).where(
                Appointment.lead_id.in_(lead_ids),
                Appointment.created_at >= start,
                Appointment.created_at <= end + APPOINTMENT_ATTRIBUTION_WINDOW + timedelta(hours=6),
            )
        )
        for a in appt_result.scalars().all():
            appointments[a.lead_id].append(a)

    # Items a manager marked as wrong are left out of the counts
    rejected: set = set()
    fb_result = await db.execute(
        select(
            CallEvaluationFeedback.evaluation_id, CallEvaluationFeedback.item_type, CallEvaluationFeedback.item_key
        ).where(
            CallEvaluationFeedback.evaluation_id.in_([e.id for _, e, _ in rows]),
            CallEvaluationFeedback.verdict == FeedbackVerdict.INACCURATE.value,
        )
    )
    for evaluation_id, item_type, item_key in fb_result.all():
        rejected.add((evaluation_id, item_type, item_key))

    calls = []
    for review, ev, ended_at in rows:
        appt = attribute_appointment(review.call_started_at, ended_at, appointments.get(review.lead_id, []))
        result_json = ev.result or {}
        calls.append(
            {
                "review_id": review.id,
                "rep_user_id": review.rep_user_id,
                "dealership_id": review.dealership_id,
                "lead_id": review.lead_id,
                "started_at": review.call_started_at,
                # Manager-corrected score wins over the AI's own
                "score": ev.adjusted_overall_score if ev.adjusted_overall_score is not None else ev.overall_score,
                "category_scores": ev.category_scores or [],
                "objections": [
                    o for i, o in enumerate(result_json.get("customer_objections") or [])
                    if (ev.id, FeedbackItemType.OBJECTION.value, str(i)) not in rejected
                ],
                # The AI's guess at the unstated objection, unless a manager said it was wrong
                "hidden_objection": (
                    None
                    if (ev.id, FeedbackItemType.HIDDEN_OBJECTION.value, "0") in rejected
                    else result_json.get("hidden_objection")
                ),
                "missed_opportunities": len(result_json.get("missed_appointment_opportunities") or []),
                # Items a manager marked wrong are dropped from the running lists
                **{
                    field: [
                        item for i, item in enumerate(result_json.get(source) or [])
                        if (ev.id, item_type.value, str(i)) not in rejected
                    ]
                    for field, source, item_type in (
                        ("strengths", "strengths", FeedbackItemType.STRENGTH),
                        ("improvements", "improvements", FeedbackItemType.IMPROVEMENT),
                        ("missed_items", "missed_appointment_opportunities", FeedbackItemType.MISSED_OPPORTUNITY),
                    )
                },
                "summary": result_json.get("summary") or "",
                "top_fix": top_fix(
                    result_json, ev.category_scores or [], {(t, k) for e, t, k in rejected if e == ev.id}
                ),
                "ai_call_outcome": ev.ai_call_outcome,
                "appointment": (
                    {"id": str(appt.id), "status": _status_value(appt.status), "scheduled_at": appt.scheduled_at}
                    if appt
                    else None
                ),
            }
        )
    return calls


async def get_dashboard(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    rep_user_id: Optional[UUID] = None,
    dealership_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    data, _, _ = await gather(db, start, end, rep_user_id, dealership_id)
    return data


async def gather(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    rep_user_id: Optional[UUID] = None,
    dealership_id: Optional[UUID] = None,
) -> tuple:
    """The dashboard plus the per-call rows and rep names it was built from."""
    calls = await load_calls(db, start, end, rep_user_id, dealership_id)
    previous = await load_calls(db, start - (end - start), start, rep_user_id, dealership_id)

    async def names(model, ids, label):
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        result = await db.execute(select(model).where(model.id.in_(ids)))
        return {row.id: label(row) for row in result.scalars().all()}

    rep_names = await names(User, [c["rep_user_id"] for c in calls], lambda u: u.full_name)
    dealership_names = await names(Dealership, [c["dealership_id"] for c in calls], lambda d: d.name)

    data = build_dashboard(calls, previous, start, end, rep_names, dealership_names)

    versions = await db.execute(
        select(CallRubric.version, CallRubric.published_at, CallRubric.change_note)
        .where(CallRubric.published_at >= start, CallRubric.published_at < end, CallRubric.version.isnot(None))
        .order_by(CallRubric.published_at)
    )
    data["rubric_changes"] = [
        {"version": v, "published_at": p.isoformat() if p else None, "change_note": n}
        for v, p, n in versions.all()
    ]
    data["period"] = {"start": start.isoformat(), "end": end.isoformat(), "truncated": len(calls) >= MAX_CALLS}
    return data, calls, rep_names


# -------------------------------------------------------- recurring issues ----

MAX_EXAMPLES = 25


def _recurring(
    calls: List[Dict[str, Any]],
    previous: List[Dict[str, Any]],
    rep_names: Dict[Any, str],
    pick,
) -> List[Dict[str, Any]]:
    """
    Group calls by `pick(call) -> [(key, label, text, extra), ...]`. A call is
    counted once per kind, however many times that kind came up on it. Returns
    rows with this period's count, last period's count, a per-rep count and the
    most recent examples.
    """
    groups: Dict[str, Dict[str, Any]] = {}
    for call in calls:  # newest first
        seen: set = set()
        for key, label, text, extra in pick(call):
            if key in seen:
                continue
            seen.add(key)
            g = groups.setdefault(key, {"key": key, "label": label, "count": 0, "reps": defaultdict(int), "examples": []})
            g["count"] += 1
            g["reps"][rep_names.get(call.get("rep_user_id")) or "Unassigned"] += 1
            if len(g["examples"]) < MAX_EXAMPLES:
                started = call.get("started_at")
                g["examples"].append({
                    "review_id": str(call["review_id"]),
                    "date": started.isoformat() if started else None,
                    "rep": rep_names.get(call.get("rep_user_id")) or "Unassigned",
                    "text": text,
                    **extra,
                })
    previous_counts: Dict[str, int] = defaultdict(int)
    for call in previous:
        for key in {p[0] for p in pick(call)}:
            previous_counts[key] += 1

    rows = []
    for g in groups.values():
        rows.append({
            "key": g["key"],
            "label": g["label"],
            "count": g["count"],
            "previous_count": previous_counts.get(g["key"], 0),
            "by_rep": sorted(({"name": n, "count": c} for n, c in g["reps"].items()), key=lambda r: (-r["count"], r["name"])),
            "examples": g["examples"],
        })
    rows.sort(key=lambda r: (-r["count"], r["label"]))
    return rows


def _category(value: Any) -> str:
    return value if value in OBJECTION_CATEGORIES else "other"


def _criterion_names(call: Dict[str, Any]) -> Dict[str, str]:
    return {c.get("key"): c.get("name") for c in call.get("category_scores") or []}


def _pick_objections(call: Dict[str, Any]):
    """Objections the customer actually said."""
    return [
        (_category(o.get("category")), OBJECTION_CATEGORIES[_category(o.get("category"))],
         o.get("objection") or "", {"resolved": bool(o.get("resolved"))})
        for o in call.get("objections") or []
    ]


def _pick_hidden(call: Dict[str, Any]):
    """The AI's guess at the objection the customer did not say."""
    h = call.get("hidden_objection")
    if not h:
        return []
    c = _category(h.get("category"))
    return [(c, OBJECTION_CATEGORIES[c], h.get("guess") or "", {"confidence": h.get("confidence")})]


def _pick_went_well(call: Dict[str, Any]):
    names = _criterion_names(call)
    out = []
    for s in call.get("strengths") or []:
        criterion = s.get("criterion")
        if criterion in names:
            out.append((f"criterion:{criterion}", f"Good at: {names[criterion]}", s.get("text") or "", {}))
        else:
            out.append(("other", "Other strengths", s.get("text") or "", {}))
    return out


def _pick_went_badly(call: Dict[str, Any]):
    """Everything flagged on the call: missed asks, objections left open, and improvements."""
    names = _criterion_names(call)
    out = []
    for m in call.get("missed_items") or []:
        out.append((MISSED_ASK_KEY, "Missed the ask for an appointment", m.get("text") or "", {}))
    for o in call.get("objections") or []:
        if not o.get("resolved"):
            c = _category(o.get("category"))
            out.append((f"objection_left_open:{c}", f"Objection left open: {OBJECTION_CATEGORIES[c]}",
                        o.get("objection") or "", {}))
    for imp in call.get("improvements") or []:
        criterion = imp.get("criterion")
        if criterion in names:
            out.append((f"criterion:{criterion}", f"Improve: {names[criterion]}", imp.get("text") or "", {}))
        else:
            out.append(("other", "Other improvements", imp.get("text") or "", {}))
    return out


def build_recurring(
    calls: List[Dict[str, Any]], previous: List[Dict[str, Any]], rep_names: Dict[Any, str]
) -> Dict[str, Any]:
    return {
        "calls_reviewed": len(calls),
        "previous_calls_reviewed": len(previous),
        "objections": _recurring(calls, previous, rep_names, _pick_objections),
        "hidden_objections": _recurring(calls, previous, rep_names, _pick_hidden),
        "went_well": _recurring(calls, previous, rep_names, _pick_went_well),
        "went_badly": _recurring(calls, previous, rep_names, _pick_went_badly),
    }


ALL_TIME_START = datetime(2000, 1, 1, tzinfo=timezone.utc)


async def get_recurring(
    db: AsyncSession,
    start: Optional[datetime],
    end: datetime,
    rep_user_id: Optional[UUID] = None,
    dealership_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    """`start=None` means all time, with nothing earlier to compare against."""
    all_time = start is None
    start = start or ALL_TIME_START
    calls = await load_calls(db, start, end, rep_user_id, dealership_id)
    previous = [] if all_time else await load_calls(db, start - (end - start), start, rep_user_id, dealership_id)
    rep_ids = [i for i in {c["rep_user_id"] for c in calls} if i]
    rep_names: Dict[Any, str] = {}
    if rep_ids:
        result = await db.execute(select(User).where(User.id.in_(rep_ids)))
        rep_names = {u.id: u.full_name for u in result.scalars().all()}
    data = build_recurring(calls, previous, rep_names)
    data["period"] = {
        "start": None if all_time else start.isoformat(),
        "end": end.isoformat(),
        "all_time": all_time,
        "truncated": len(calls) >= MAX_CALLS,
    }
    return data
