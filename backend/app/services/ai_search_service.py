"""
Natural-language CRM search for the global search modal.

Interprets a user question (OpenAI + heuristics) and finds matching leads by
contact info, notes, timeline content, and activity frequency
(e.g. "called 3 times in 7 days").
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access_scope import get_accessible_dealership_ids
from app.core.config import settings
from app.core.permissions import UserRole
from app.models.activity import Activity, ActivityType
from app.models.call_log import CallLog
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_stage import LeadStage
from app.models.user import User

logger = logging.getLogger(__name__)

ACTIVITY_ALIASES: Dict[str, List[str]] = {
    "call": ["call_logged"],
    "calls": ["call_logged"],
    "called": ["call_logged"],
    "phone": ["call_logged"],
    "sms": ["sms_sent", "sms_received"],
    "text": ["sms_sent", "sms_received"],
    "texts": ["sms_sent", "sms_received"],
    "whatsapp": ["whatsapp_sent", "whatsapp_received"],
    "email": ["email_sent", "email_received"],
    "emails": ["email_sent", "email_received"],
    "note": ["note_added"],
    "notes": ["note_added"],
    "appointment": ["appointment_scheduled", "appointment_completed"],
    "followup": ["follow_up_scheduled", "follow_up_completed", "follow_up_missed"],
    "follow-up": ["follow_up_scheduled", "follow_up_completed", "follow_up_missed"],
}

MAX_RESULTS = 25
MAX_CANDIDATES = 400

_PHONE_RE = re.compile(r"[\d\+\-\(\)\s]{7,}")
_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_COUNT_IN_DAYS_RE = re.compile(
    r"(?:called|calls?|contacted|texts?|texted|sms|whatsapp|emails?|notes?)\s+"
    r"(?:at\s+least\s+)?(\d+)\s*(?:times?|x)?\s+(?:in|over|within)\s+(?:the\s+last\s+)?(\d+)\s*days?",
    re.I,
)
_TIMES_IN_DAYS_RE = re.compile(
    r"(\d+)\s*(?:times?|calls?|texts?)\s+(?:in|over|within)\s+(?:the\s+last\s+)?(\d+)\s*days?",
    re.I,
)
_NO_ACTIVITY_RE = re.compile(
    r"(?:no|not|haven'?t|without)\s+(?:been\s+)?(?:called|contacted|activity|calls?|texts?|whatsapp|emails?)"
    r"(?:\s+(?:in|for|over|within)\s+(?:the\s+last\s+)?(\d+)\s*days?)?",
    re.I,
)


def _empty_intent(query: str) -> Dict[str, Any]:
    return {
        "interpretation": query.strip(),
        "contact_search": None,
        "content_query": None,
        "activity": None,
        "lead": {},
    }


def _looks_like_contact(query: str) -> bool:
    t = query.strip()
    if not t:
        return False
    if _EMAIL_RE.search(t) or (sum(ch.isdigit() for ch in t) >= 7):
        return True
    words = re.findall(r"[A-Za-z]{2,}", t)
    verbs = {
        "call", "called", "calls", "mention", "mentioned", "note", "notes",
        "said", "texted", "whatsapp", "email", "find", "show", "who", "have",
        "has", "been", "last", "days", "times", "without", "stip",
    }
    return 1 <= len(words) <= 3 and not any(w.lower() in verbs for w in words)


def heuristic_intent(query: str) -> Dict[str, Any]:
    """Fallback when OpenAI is unavailable or returns invalid JSON."""
    raw = (query or "").strip()
    intent = _empty_intent(raw)
    lower = raw.lower()

    count_match = _COUNT_IN_DAYS_RE.search(raw) or _TIMES_IN_DAYS_RE.search(raw)
    if count_match:
        min_count = int(count_match.group(1))
        days = int(count_match.group(2))
        types = ["call_logged"]
        if "text" in lower or "sms" in lower:
            types = ["sms_sent", "sms_received"]
        elif "whatsapp" in lower:
            types = ["whatsapp_sent", "whatsapp_received"]
        elif "email" in lower:
            types = ["email_sent", "email_received"]
        elif "note" in lower:
            types = ["note_added"]
        intent["activity"] = {
            "types": types,
            "min_count": min_count,
            "days": days,
            "no_activity": False,
        }
        intent["interpretation"] = f"Leads with at least {min_count} matching activities in the last {days} days"

    no_match = _NO_ACTIVITY_RE.search(raw)
    if no_match and not count_match:
        days = int(no_match.group(1)) if no_match.group(1) else 7
        types = ["call_logged"]
        if "text" in lower or "sms" in lower:
            types = ["sms_sent", "sms_received"]
        elif "whatsapp" in lower:
            types = ["whatsapp_sent", "whatsapp_received"]
        intent["activity"] = {
            "types": types,
            "min_count": None,
            "days": days,
            "no_activity": True,
        }
        intent["interpretation"] = f"Leads with no matching contact in the last {days} days"

    if _looks_like_contact(raw):
        intent["contact_search"] = raw
        if not intent["activity"]:
            intent["interpretation"] = f"Leads matching “{raw}”"
        return intent

    content_hints = (
        "mention", "noted", "notes", "said", "talked", "discussed", "wants",
        "looking", "financ", "credit", "camry", "vehicle", "appointment",
        "promised", "complain", "hot", "ready",
    )
    if any(h in lower for h in content_hints) or "?" in raw:
        intent["content_query"] = raw
        if not intent["activity"]:
            intent["interpretation"] = f"Leads whose notes or activity mention this"

    if "unassigned" in lower:
        intent["lead"]["pool"] = "unassigned"
    elif "my lead" in lower or "assigned to me" in lower:
        intent["lead"]["pool"] = "mine"
    if "ssn" in lower:
        intent["lead"]["has_ssn_stip"] = True
    if "dl stip" in lower or "license stip" in lower or "driver" in lower and "stip" in lower:
        intent["lead"]["has_dl_stip"] = True
    if "fresh" in lower:
        intent["lead"]["fresh_only"] = True

    if not intent["contact_search"] and not intent["content_query"] and not intent["activity"]:
        intent["contact_search"] = raw
        intent["content_query"] = raw
        intent["interpretation"] = f"Leads or activity matching “{raw}”"

    return intent


async def interpret_query(query: str, user: User) -> Dict[str, Any]:
    fallback = heuristic_intent(query)
    if not settings.openai_api_key:
        fallback["parsed_by"] = "heuristic"
        return fallback

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        search_model = "gpt-4o-mini"
        system = (
            "You turn a CRM search question into JSON filters. "
            "Return ONLY JSON with keys: interpretation, contact_search, content_query, activity, lead.\n"
            "activity: {types: string[] of activity type values, min_count: int|null, days: int|null, no_activity: bool}\n"
            "Valid activity types: call_logged, note_added, sms_sent, sms_received, whatsapp_sent, "
            "whatsapp_received, email_sent, email_received, appointment_scheduled, follow_up_scheduled, "
            "follow_up_missed, follow_up_completed.\n"
            "lead: {pool: mine|unassigned|null, stage_name: string|null, source: string|null, "
            "has_ssn_stip: bool|null, has_dl_stip: bool|null, fresh_only: bool|null, "
            "created_days: int|null, is_active: bool|null}\n"
            "contact_search: name, phone, or email if they named a person.\n"
            "content_query: keywords to find in notes/calls/messages (not the whole sentence if it is only a count query).\n"
            "For 'called 3 times in 7 days' set activity.types=['call_logged'], min_count=3, days=7, content_query=null.\n"
            "For 'no calls this week' set no_activity=true, days=7, types=['call_logged'].\n"
            "Do not invent filters the user did not imply."
        )
        resp = await client.chat.completions.create(
            model=search_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"Role: {getattr(user.role, 'value', user.role)}\nQuery: {query}",
                },
            ],
            timeout=12,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
        intent = _normalize_intent(data, fallback)
        intent["parsed_by"] = "ai"
        return intent
    except Exception as exc:
        logger.warning("AI search interpret failed, using heuristic: %s", exc)
        fallback["parsed_by"] = "heuristic"
        return fallback


def _normalize_intent(data: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    intent = _empty_intent(str(data.get("interpretation") or fallback.get("interpretation") or ""))
    if data.get("contact_search"):
        intent["contact_search"] = str(data["contact_search"]).strip() or None
    if data.get("content_query"):
        intent["content_query"] = str(data["content_query"]).strip() or None

    activity = data.get("activity") or {}
    if isinstance(activity, dict) and any(activity.get(k) for k in ("types", "min_count", "days", "no_activity")):
        types = _normalize_activity_types(activity.get("types"))
        intent["activity"] = {
            "types": types,
            "min_count": _as_int(activity.get("min_count")),
            "days": _as_int(activity.get("days")) or 7,
            "no_activity": bool(activity.get("no_activity")),
        }

    lead = data.get("lead") or {}
    if isinstance(lead, dict):
        pool = lead.get("pool")
        intent["lead"] = {
            k: v
            for k, v in {
                "pool": pool if pool in ("mine", "unassigned") else None,
                "stage_name": (str(lead["stage_name"]).strip() if lead.get("stage_name") else None),
                "source": (str(lead["source"]).strip() if lead.get("source") else None),
                "has_ssn_stip": lead.get("has_ssn_stip"),
                "has_dl_stip": lead.get("has_dl_stip"),
                "fresh_only": lead.get("fresh_only"),
                "created_days": _as_int(lead.get("created_days")),
                "is_active": lead.get("is_active"),
            }.items()
            if v is not None
        }

    if not intent["contact_search"] and not intent["content_query"] and not intent["activity"] and not intent["lead"]:
        return fallback
    return intent


def _as_int(value: Any) -> Optional[int]:
    try:
        if value is None or value is False:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_activity_types(values: Any) -> List[str]:
    if not values:
        return ["call_logged"]
    if isinstance(values, str):
        values = [values]
    out: List[str] = []
    for raw in values:
        key = str(raw or "").strip().lower().replace(" ", "_")
        if key in ACTIVITY_ALIASES:
            out.extend(ACTIVITY_ALIASES[key])
            continue
        try:
            out.append(ActivityType(key).value)
        except ValueError:
            continue
    return list(dict.fromkeys(out)) or ["call_logged"]


class AiSearchService:
    @classmethod
    async def search(cls, db: AsyncSession, user: User, query: str) -> Dict[str, Any]:
        q = (query or "").strip()
        if len(q) < 2:
            return {
                "interpretation": "",
                "parsed_by": "none",
                "total": 0,
                "leads": [],
            }

        intent = await interpret_query(q, user)
        if user.role == UserRole.SALESPERSON and not (intent.get("lead") or {}).get("pool"):
            intent.setdefault("lead", {})["pool"] = "mine"

        accessible = await get_accessible_dealership_ids(db, user)
        lead_filters = intent.get("lead") or {}
        stage_id = await cls._resolve_stage_id(db, user, accessible, lead_filters.get("stage_name"))

        base_ids = await cls._visible_lead_ids(
            db, user, accessible, lead_filters, intent.get("contact_search"), stage_id
        )

        activity = intent.get("activity")
        activity_counts: Dict[UUID, int] = {}
        if activity:
            activity_counts = await cls._activity_counts(
                db, user, accessible, activity, lead_filters.get("pool")
            )
            if activity.get("no_activity"):
                exclude = set(activity_counts.keys())
                # Prefer recently updated visible leads with no matching activity
                base_ids = [lid for lid in base_ids if lid not in exclude]
            elif activity.get("min_count"):
                need = int(activity["min_count"])
                ranked = [
                    lid
                    for lid, n in sorted(activity_counts.items(), key=lambda x: -x[1])
                    if n >= need
                ]
                if intent.get("contact_search") or lead_filters.get("stage_name") or lead_filters.get("source"):
                    allowed = set(ranked)
                    base_ids = [lid for lid in base_ids if lid in allowed]
                else:
                    # Activity query is already RBAC-scoped — don't clip to recent leads
                    base_ids = ranked

        snippets_by_lead: Dict[str, List[Dict[str, Any]]] = {}
        content_query = (intent.get("content_query") or "").strip()
        if content_query:
            from app.services.crm_content_search_service import CrmContentSearchService

            content = await CrmContentSearchService.search(
                db,
                user,
                query=content_query,
                days=(activity or {}).get("days"),
                activity_types=(activity or {}).get("types"),
                pool=lead_filters.get("pool"),
                limit=min(settings.crm_search_max_results, 200),
                offset=0,
            )
            grouped = content.get("grouped_leads") or []
            content_ids: List[UUID] = []
            for row in grouped:
                try:
                    lid = UUID(str(row.get("lead_id")))
                except (TypeError, ValueError):
                    continue
                content_ids.append(lid)
                snippets_by_lead[str(lid)] = row.get("snippets") or []

            if activity and (activity.get("min_count") or activity.get("no_activity")):
                content_set = set(content_ids)
                base_ids = [lid for lid in base_ids if lid in content_set]
            elif intent.get("contact_search") or lead_filters.get("stage_name") or lead_filters.get("source"):
                content_set = set(content_ids)
                base_ids = [lid for lid in base_ids if lid in content_set]
            else:
                visible = set(base_ids)
                base_ids = [lid for lid in content_ids if lid in visible]

        chosen = base_ids[:MAX_RESULTS]
        leads = await cls._hydrate_leads(
            db, chosen, snippets_by_lead, activity_counts, intent
        )
        return {
            "interpretation": intent.get("interpretation") or q,
            "parsed_by": intent.get("parsed_by") or "heuristic",
            "intent": {
                "contact_search": intent.get("contact_search"),
                "content_query": intent.get("content_query"),
                "activity": intent.get("activity"),
                "lead": intent.get("lead"),
            },
            "total": len(base_ids),
            "returned": len(leads),
            "leads": leads,
        }

    @staticmethod
    async def _resolve_stage_id(
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        stage_name: Optional[str],
    ) -> Optional[UUID]:
        if not stage_name:
            return None
        needle = stage_name.strip().lower()
        q = select(LeadStage).where(LeadStage.is_active == True)  # noqa: E712
        if accessible is not None:
            if accessible:
                q = q.where(
                    (LeadStage.dealership_id.is_(None)) | (LeadStage.dealership_id.in_(accessible))
                )
            else:
                return None
        rows = (await db.execute(q)).scalars().all()
        for s in rows:
            if needle in (s.name or "").lower() or needle in (s.display_name or "").lower():
                return s.id
        return None

    @staticmethod
    async def _visible_lead_ids(
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        lead_filters: Dict[str, Any],
        contact_search: Optional[str],
        stage_id: Optional[UUID],
    ) -> List[UUID]:
        from app.api.v1.endpoints.leads import _build_leads_list_select
        from app.models.lead import LeadSource

        source = None
        if lead_filters.get("source"):
            raw = str(lead_filters["source"]).strip().lower().replace(" ", "_")
            try:
                source = LeadSource(raw)
            except ValueError:
                source = None

        created_days = lead_filters.get("created_days")
        date_from = None
        if created_days:
            date_from = datetime.now(timezone.utc) - timedelta(days=int(created_days))

        query = _build_leads_list_select(
            user,
            accessible,
            pool=lead_filters.get("pool"),
            stage_id=stage_id,
            source=source,
            search=contact_search,
            is_active=lead_filters.get("is_active"),
            date_from=date_from,
            fresh_only=lead_filters.get("fresh_only"),
            has_ssn_stip=lead_filters.get("has_ssn_stip"),
            has_dl_stip=lead_filters.get("has_dl_stip"),
        )
        query = query.order_by(Lead.updated_at.desc()).limit(MAX_CANDIDATES)
        rows = (await db.execute(query)).scalars().all()
        return [lead.id for lead in rows]

    @staticmethod
    async def _activity_counts(
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        activity: Dict[str, Any],
        pool: Optional[str],
    ) -> Dict[UUID, int]:
        types = _normalize_activity_types(activity.get("types"))
        days = int(activity.get("days") or 7)
        since = datetime.now(timezone.utc) - timedelta(days=days)

        parsed: List[ActivityType] = []
        for t in types:
            try:
                parsed.append(ActivityType(t))
            except ValueError:
                continue

        q = (
            select(Activity.lead_id, func.count(Activity.id))
            .join(Lead, Activity.lead_id == Lead.id)
            .where(Activity.lead_id.isnot(None))
            .where(Activity.created_at >= since)
            .group_by(Activity.lead_id)
        )
        if parsed:
            q = q.where(Activity.type.in_(parsed))

        if pool == "mine":
            q = q.where(Lead.assigned_to == user.id)
        elif pool == "unassigned":
            q = q.where(Lead.assigned_to.is_(None))
        if pool != "mine":
            if accessible is not None:
                if not accessible:
                    return {}
                q = q.where(or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None)))

        counts: Dict[UUID, int] = {}
        for lead_id, n in (await db.execute(q)).all():
            if lead_id:
                counts[lead_id] = int(n)

        if "call_logged" in types:
            cq = (
                select(CallLog.lead_id, func.count(CallLog.id))
                .join(Lead, CallLog.lead_id == Lead.id)
                .where(CallLog.lead_id.isnot(None))
                .where(CallLog.created_at >= since)
                .group_by(CallLog.lead_id)
            )
            if pool == "mine":
                cq = cq.where(Lead.assigned_to == user.id)
            elif pool == "unassigned":
                cq = cq.where(Lead.assigned_to.is_(None))
            if pool != "mine" and accessible is not None:
                if not accessible:
                    return counts
                cq = cq.where(or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None)))
            for lead_id, n in (await db.execute(cq)).all():
                if not lead_id:
                    continue
                # Prefer the higher of timeline vs Twilio so we don't miss calls
                counts[lead_id] = max(counts.get(lead_id, 0), int(n))

        return counts

    @staticmethod
    async def _hydrate_leads(
        db: AsyncSession,
        lead_ids: Sequence[UUID],
        snippets_by_lead: Dict[str, List[Dict[str, Any]]],
        activity_counts: Dict[UUID, int],
        intent: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not lead_ids:
            return []
        from app.api.v1.endpoints.leads import enrich_leads_with_relations

        result = await db.execute(select(Lead).where(Lead.id.in_(list(lead_ids))))
        leads = list(result.scalars().all())
        by_id = {lead.id: lead for lead in leads}
        ordered = [by_id[i] for i in lead_ids if i in by_id]
        enriched = await enrich_leads_with_relations(db, ordered)

        activity = intent.get("activity") or {}
        out: List[Dict[str, Any]] = []
        for item in enriched:
            if isinstance(item, dict):
                lid = str(item.get("id"))
                try:
                    lid_uuid = UUID(lid)
                except (TypeError, ValueError):
                    continue
                cust = item.get("customer") or {}
                name = f"{cust.get('first_name') or ''} {cust.get('last_name') or ''}".strip() or "Unknown"
                stage = (item.get("stage") or {}).get("display_name") or (item.get("stage") or {}).get("name")
                phone = cust.get("phone")
                email = cust.get("email")
                source = item.get("source_display") or item.get("source")
            else:
                lid_uuid = item.id
                lid = str(item.id)
                cust = getattr(item, "customer", None)
                name = (
                    f"{getattr(cust, 'first_name', '') or ''} {getattr(cust, 'last_name', '') or ''}".strip()
                    or "Unknown"
                )
                stage_obj = getattr(item, "stage", None)
                stage = getattr(stage_obj, "display_name", None) or getattr(stage_obj, "name", None)
                phone = getattr(cust, "phone", None)
                email = getattr(cust, "email", None)
                source = getattr(item, "source_display", None) or getattr(getattr(item, "source", None), "value", None)

            reasons: List[str] = []
            count = activity_counts.get(lid_uuid)
            if count and activity.get("min_count"):
                days = activity.get("days") or 7
                label = _activity_reason_label(activity.get("types"))
                reasons.append(f"{count} {label} in the last {days} days")
            if activity.get("no_activity"):
                days = activity.get("days") or 7
                label = _activity_reason_label(activity.get("types"))
                reasons.append(f"No {label} in the last {days} days")
            if intent.get("contact_search"):
                reasons.append(f"Matches “{intent['contact_search']}”")
            snippets = snippets_by_lead.get(lid) or []
            if snippets:
                reasons.append("Mentioned in notes or activity")

            out.append(
                {
                    "id": lid,
                    "name": name,
                    "phone": phone,
                    "email": email,
                    "stage": stage,
                    "source": source,
                    "activity_count": count,
                    "reasons": reasons,
                    "snippets": snippets[:3],
                }
            )
        return out


def _activity_reason_label(types: Optional[Sequence[str]]) -> str:
    types = list(types or [])
    if any(t.startswith("call") for t in types):
        return "calls"
    if any(t.startswith("sms") for t in types):
        return "texts"
    if any(t.startswith("whatsapp") for t in types):
        return "WhatsApp messages"
    if any(t.startswith("email") for t in types):
        return "emails"
    if any(t.startswith("note") for t in types):
        return "notes"
    return "activities"
