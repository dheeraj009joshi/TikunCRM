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
from datetime import datetime, timedelta
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

    # Objections a manager marked as wrong are left out of the counts
    rejected: set = set()
    fb_result = await db.execute(
        select(CallEvaluationFeedback.evaluation_id, CallEvaluationFeedback.item_key).where(
            CallEvaluationFeedback.evaluation_id.in_([e.id for _, e, _ in rows]),
            CallEvaluationFeedback.item_type == FeedbackItemType.OBJECTION.value,
            CallEvaluationFeedback.verdict == FeedbackVerdict.INACCURATE.value,
        )
    )
    for evaluation_id, item_key in fb_result.all():
        rejected.add((evaluation_id, item_key))

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
                    if (ev.id, str(i)) not in rejected
                ],
                "missed_opportunities": len(result_json.get("missed_appointment_opportunities") or []),
                "summary": result_json.get("summary") or "",
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
