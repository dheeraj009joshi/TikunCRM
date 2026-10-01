"""
Natural-language CRM search for the global search modal.

Interprets a user question (OpenAI + heuristics) and finds matching leads by
contact info, notes, timeline content, and activity frequency
(e.g. "called 3 times in 7 days").
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access_scope import get_accessible_dealership_ids
from app.core.permissions import UserRole
from app.models.activity import Activity, ActivityType
from app.models.call_log import CallLog
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_stage import LeadStage
from app.models.user import User
from app.services.crm_content_search_service import (
    CrmContentSearchService,
    extract_mentioned_credit,
)

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
NOTE_HIT_LIMIT = 80

_QUERY_STOPWORDS = frozenset(
    {
        "the", "and", "for", "that", "this", "with", "from", "have", "has",
        "was", "were", "are", "about", "into", "your", "their", "they", "them",
        "who", "what", "when", "where", "which", "will", "would", "could",
        "should", "been", "being", "also", "just", "like", "lead", "leads",
        "want", "wanted", "wants", "customer", "customers", "please", "find",
        "show", "give", "get", "need", "looking", "look", "tell", "me", "my",
        "our", "you", "any", "all", "someone", "somebody", "person", "people",
        "one", "ones", "whose", "whom", "there", "here", "than", "then",
        "can", "could", "does", "did", "dont", "not", "how", "why",
    }
)

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
_CREDIT_OVER_RE = re.compile(
    r"(?:more\s+th[ae]n|over|above|greater\s+than|at\s+least|minimum|>=|>)\s*(\d{3,4})\s*(?:\+)?\s*(?:credit|fico|score)?",
    re.I,
)
_CREDIT_UNDER_RE = re.compile(
    r"(?:less\s+th[ae]n|under|below|at\s+most|no\s+more\s+th[ae]n|<=|<)\s*(\d{3,4})\s*(?:\+)?\s*(?:credit|fico|score)?",
    re.I,
)
_CREDIT_BARE_RE = re.compile(
    r"(?:credit|fico|score)\s*(?:of\s+|is\s+|around\s+|about\s*)?(\d{3,4})"
    r"|(\d{3,4})\s*(?:\+)?\s*(?:credit|fico|score)",
    re.I,
)
_EXCLUDE_STATUS_RE = re.compile(
    r"(?:status|stage)s?\s+(?:is\s+|are\s+)?not\s+(.+)$",
    re.I,
)
_STAGE_TOKEN_RE = re.compile(r"[a-z][a-z_ ]{1,30}")
_STAGE_ALIASES: Dict[str, List[str]] = {
    "sold": ["sold", "converted"],
    "converted": ["converted", "sold"],
    "lost": ["lost"],
    "new": ["new"],
    "contacted": ["contacted"],
    "interested": ["interested"],
    "qualified": ["qualified"],
    "follow up": ["follow_up", "follow up"],
    "follow_up": ["follow_up", "follow up"],
    "not interested": ["not_interested", "not interested"],
}
_FILTER_STOPWORDS = frozenset(
    {
        "lead", "leads", "with", "more", "than", "then", "over", "above", "and",
        "status", "stage", "not", "or", "the", "a", "an", "credit", "fico",
        "score", "sold", "converted", "lost", "customer", "customers",
    }
)


def _normalize_stage_tokens(raw: str) -> List[str]:
    parts = re.split(r"\s*(?:,|/|\bor\b|\band\b)\s*", (raw or "").strip().lower())
    out: List[str] = []
    for part in parts:
        token = " ".join(part.split())
        if not token or token in {"is", "are", "the", "a"}:
            continue
        aliases = _STAGE_ALIASES.get(token) or _STAGE_ALIASES.get(token.replace(" ", "_"))
        if aliases:
            out.extend(aliases)
        elif _STAGE_TOKEN_RE.fullmatch(token):
            out.append(token.replace(" ", "_"))
            out.append(token)
    return list(dict.fromkeys(out))


def parse_structured_filters(query: str) -> Dict[str, Any]:
    """Pull credit/stage constraints out of a natural-language question."""
    raw = query or ""
    lower = raw.lower()
    filters: Dict[str, Any] = {}

    over = _CREDIT_OVER_RE.search(raw)
    under = _CREDIT_UNDER_RE.search(raw)
    bare = _CREDIT_BARE_RE.search(raw)
    if over:
        filters["credit_min"] = int(over.group(1))
    elif under:
        filters["credit_max"] = int(under.group(1))
    elif bare:
        n = int(bare.group(1) or bare.group(2))
        if 300 <= n <= 850:
            filters["credit_min"] = n

    exclude: List[str] = []
    status_not = _EXCLUDE_STATUS_RE.search(raw)
    if status_not:
        exclude.extend(_normalize_stage_tokens(status_not.group(1)))
    if re.search(r"\bnot\s+sold\b", lower) or re.search(r"\bexcluding\s+sold\b", lower):
        exclude.extend(_STAGE_ALIASES["sold"])
    if re.search(r"\bnot\s+converted\b", lower) or re.search(r"\bexcluding\s+converted\b", lower):
        exclude.extend(_STAGE_ALIASES["converted"])
    if exclude:
        filters["exclude_stages"] = list(dict.fromkeys(exclude))

    return filters


def _content_query_without_filters(query: str, filters: Dict[str, Any]) -> Optional[str]:
    tokens = [
        t for t in extract_search_tokens(query)
        if t not in _FILTER_STOPWORDS and not t.isdigit()
    ]
    if filters.get("credit_min") or filters.get("credit_max") or filters.get("exclude_stages"):
        leftover = [t for t in tokens if t not in {"status", "stage"}]
        return " ".join(leftover) if leftover else None
    return " ".join(tokens) if tokens else None


def _describe_filters(filters: Dict[str, Any]) -> str:
    bits: List[str] = []
    if filters.get("credit_min") is not None:
        bits.append(f"credit score ≥ {filters['credit_min']}")
    if filters.get("credit_max") is not None:
        bits.append(f"credit score ≤ {filters['credit_max']}")
    if filters.get("exclude_stages"):
        shown = ", ".join(s.replace("_", " ").title() for s in filters["exclude_stages"] if s in ("sold", "converted", "lost") or " " not in s)
        # unique display
        labels = []
        seen = set()
        for s in filters["exclude_stages"]:
            label = s.replace("_", " ").title()
            if label.lower() in seen:
                continue
            seen.add(label.lower())
            labels.append(label)
        bits.append("excluding " + " and ".join(labels))
    return ", ".join(bits)


def _empty_intent(query: str) -> Dict[str, Any]:
    return {
        "interpretation": query.strip(),
        "contact_search": None,
        "content_query": None,
        "activity": None,
        "lead": {},
    }


_MEANING_SYNONYMS: Dict[str, List[str]] = {
    "credit": ["credit", "fico", "score", "bureau", "transunion", "experian"],
    "fico": ["fico", "credit", "score"],
    "score": ["score", "credit", "fico"],
    "financ": ["finance", "financing", "loan", "apr", "payment"],
    "finance": ["finance", "financing", "loan", "apr"],
    "financing": ["financing", "finance", "loan"],
    "down": ["down", "downpayment", "down-payment"],
    "downpayment": ["downpayment", "down payment", "down"],
    "ssn": ["ssn", "social", "itin"],
    "license": ["license", "dl", "driver"],
    "camry": ["camry", "toyota"],
    "whatsapp": ["whatsapp", "wa"],
    "appointment": ["appointment", "appt", "scheduled"],
    "trade": ["trade", "trade-in", "tradein"],
}


def extract_search_tokens(query: str, limit: int = 8) -> List[str]:
    """Keep numbers and meaningful words; drop filler so notes can match."""
    tokens: List[str] = []
    seen = set()
    for raw in re.findall(r"[a-zA-Z0-9]{2,}", (query or "").lower()):
        if raw in _QUERY_STOPWORDS or raw in seen:
            continue
        seen.add(raw)
        tokens.append(raw)
        if len(tokens) >= limit:
            break
    return tokens


def expand_meaning_terms(query: str) -> List[List[str]]:
    """
    Turn a question into meaning groups.
    'want the customer who has the 600 credit' → [['600','590','610'], ['credit','fico','score']]
    A strong hit matches every group; a weak hit matches any group.
    """
    tokens = extract_search_tokens(query)
    groups: List[List[str]] = []
    used = set()

    for tok in tokens:
        if tok in used:
            continue
        if tok.isdigit():
            n = int(tok)
            nums = {tok}
            if 300 <= n <= 850:
                for delta in (-20, -10, 10, 20):
                    nxt = n + delta
                    if 300 <= nxt <= 850:
                        nums.add(str(nxt))
            groups.append(sorted(nums, key=lambda x: (x != tok, x)))
            used.add(tok)
            continue
        synonyms = None
        for key, vals in _MEANING_SYNONYMS.items():
            if tok == key or tok.startswith(key) or key.startswith(tok):
                synonyms = vals
                break
        if synonyms:
            groups.append(list(dict.fromkeys(synonyms)))
            used.update(synonyms)
            used.add(tok)
        else:
            groups.append([tok])
            used.add(tok)

    return groups or [[t] for t in tokens]


def _meaning_score(text: str, groups: List[List[str]]) -> int:
    """Score how well blob matches meaning groups. 0 = no useful match."""
    if not text or not groups:
        return 0
    hits = 0
    for group in groups:
        if any(term.lower() in text for term in group):
            hits += 1
    if hits == 0:
        return 0
    # Prefer matching the idea (all groups) over a single related word
    return hits * 3 + (2 if hits == len(groups) else 0)


def flatten_terms(groups: List[List[str]]) -> List[str]:
    out: List[str] = []
    seen = set()
    for group in groups:
        for term in group:
            key = term.lower()
            if key in seen or len(key) < 2:
                continue
            seen.add(key)
            out.append(term)
    return out


_CONTACT_CONTENT_WORDS = frozenset(
    {
        "credit", "fico", "score", "finance", "financing", "loan", "mention",
        "mentioned", "note", "notes", "said", "call", "called", "calls",
        "texted", "whatsapp", "email", "emails", "stip", "ssn", "appointment",
        "want", "wanted", "customer", "customers", "lead", "leads", "times",
        "days", "week", "last", "without", "been", "have", "has", "who",
        "find", "show", "give", "need", "looking",
    }
)


def _looks_like_contact(query: str) -> bool:
    """Name, email, or phone fragment — not a notes/meaning question."""
    t = query.strip()
    if not t or len(t) < 3:
        return False
    if _EMAIL_RE.search(t):
        return True
    letters = re.sub(r"[^A-Za-z]", "", t)
    digits = re.sub(r"\D", "", t)
    # Phone fragment: 787, 7877424770, +91 787… — ignore country code / punctuation
    if len(digits) >= 3 and len(letters) <= 2 and re.fullmatch(r"[\d+\-() .\u2013]+", t):
        return True
    words = [w.lower() for w in re.findall(r"[A-Za-z]{2,}", t)]
    if any(w in _CONTACT_CONTENT_WORDS for w in words):
        return False
    # Name, or name + phone: "Ing", "John Smith", "John 787"
    compact = t.replace(" ", "").replace("-", "").replace("'", "")
    if letters and compact.isalnum() and 1 <= len(words) <= 4:
        return True
    return False


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
        digits = re.sub(r"\D", "", raw)
        if digits and len(re.sub(r"[^A-Za-z]", "", raw)) <= 2:
            intent["interpretation"] = f"Contacts matching phone {digits}"
        elif not intent["activity"]:
            intent["interpretation"] = f"Leads matching “{raw}”"
        return intent

    structured = parse_structured_filters(raw)
    if structured:
        intent["lead"].update(structured)

    find_someone = any(
        p in lower
        for p in (
            "who has", "who have", "customer who", "lead who", "someone",
            "find", "show me", "looking for", "want the", "wants the",
            "mention", "notes", "said", "credit", "financ",
        )
    ) or "?" in raw
    leftover = _content_query_without_filters(raw, structured)
    if leftover and not intent["activity"]:
        intent["content_query"] = leftover
    elif find_someone and not intent["activity"] and not structured:
        tokens = extract_search_tokens(raw)
        intent["content_query"] = " ".join(tokens) if tokens else raw

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

    described = _describe_filters(structured)
    if described and leftover:
        intent["interpretation"] = f"{described.capitalize()}; notes about {leftover}"
    elif described:
        intent["interpretation"] = described[0].upper() + described[1:]
    elif leftover and find_someone and not intent["activity"]:
        intent["interpretation"] = f"Notes or activity about {leftover}"

    if not intent["contact_search"] and not intent["content_query"] and not intent["activity"] and not intent["lead"]:
        tokens = extract_search_tokens(raw)
        intent["contact_search"] = raw if _looks_like_contact(raw) else None
        intent["content_query"] = " ".join(tokens) if tokens else raw
        intent["interpretation"] = f"Leads or notes matching {intent['content_query']}"

    return intent


async def interpret_query(query: str, user: User) -> Dict[str, Any]:
    # Keep the modal instant — keyword/heuristic parse only (no LLM round-trip).
    intent = heuristic_intent(query)
    intent["parsed_by"] = "heuristic"
    return intent


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
                "credit_min": _as_int(lead.get("credit_min")),
                "credit_max": _as_int(lead.get("credit_max")),
                "exclude_stages": lead.get("exclude_stages") or None,
                "include_stages": lead.get("include_stages") or None,
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
        has_structured = bool(
            lead_filters.get("credit_min") is not None
            or lead_filters.get("credit_max") is not None
            or lead_filters.get("exclude_stages")
            or lead_filters.get("include_stages")
        )
        needs_lead_scan = bool(
            intent.get("contact_search")
            or lead_filters.get("stage_name")
            or lead_filters.get("source")
            or lead_filters.get("has_ssn_stip")
            or lead_filters.get("has_dl_stip")
            or lead_filters.get("fresh_only")
            or (intent.get("activity") or {}).get("no_activity")
        )

        stage_id = None
        base_ids: List[UUID] = []
        backend_used = "postgres"
        if needs_lead_scan:
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
                if not base_ids:
                    base_ids = await cls._visible_lead_ids(
                        db, user, accessible, lead_filters, None, None
                    )
                exclude = set(activity_counts.keys())
                base_ids = [lid for lid in base_ids if lid not in exclude]
            elif activity.get("min_count"):
                need = int(activity["min_count"])
                ranked = [
                    lid
                    for lid, n in sorted(activity_counts.items(), key=lambda x: -x[1])
                    if n >= need
                ]
                if base_ids:
                    allowed = set(ranked)
                    base_ids = [lid for lid in base_ids if lid in allowed]
                else:
                    base_ids = ranked

        snippets_by_lead: Dict[str, List[Dict[str, Any]]] = {}
        content_query = (intent.get("content_query") or "").strip()

        if has_structured:
            structured_ids, note_snips = await cls._structured_lead_ids(
                db, user, accessible, lead_filters
            )
            snippets_by_lead.update(note_snips)
            if base_ids:
                allowed = set(structured_ids)
                base_ids = [lid for lid in base_ids if lid in allowed]
            else:
                base_ids = structured_ids
            backend_used = "structured"

        if content_query or (
            has_structured and CrmContentSearchService.is_azure_configured()
        ):
            azure_ids, azure_snips, azure_ok = await cls._search_azure_or_notes(
                db,
                user,
                accessible,
                content_query or q,
                lead_filters,
            )
            if azure_snips:
                for lid, snips in azure_snips.items():
                    snippets_by_lead.setdefault(lid, []).extend(snips)
            if azure_ok:
                if azure_ids:
                    backend_used = "azure"
                if has_structured:
                    extra = [lid for lid in azure_ids if lid not in set(base_ids)]
                    # Azure already applied the same filters; union mentioned-credit hits
                    if extra:
                        base_ids = extra + base_ids
                elif base_ids:
                    allowed = set(azure_ids)
                    base_ids = [lid for lid in base_ids if lid in allowed]
                else:
                    base_ids = azure_ids
            elif content_query and not has_structured:
                content_ids, note_snips = await cls._search_notes(
                    db,
                    user,
                    accessible,
                    content_query,
                    pool=lead_filters.get("pool"),
                )
                snippets_by_lead.update(note_snips)
                if base_ids:
                    allowed = set(content_ids)
                    base_ids = [lid for lid in base_ids if lid in allowed]
                else:
                    base_ids = content_ids

        seen: set[UUID] = set()
        ordered: List[UUID] = []
        for lid in base_ids:
            if lid not in seen:
                seen.add(lid)
                ordered.append(lid)
        base_ids = ordered

        chosen = base_ids[:MAX_RESULTS]
        leads = await cls._hydrate_leads(
            db, chosen, snippets_by_lead, activity_counts, intent
        )
        return {
            "interpretation": intent.get("interpretation") or q,
            "parsed_by": "azure" if backend_used == "azure" else (intent.get("parsed_by") or "heuristic"),
            "backend": backend_used,
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

    @classmethod
    async def _structured_lead_ids(
        cls,
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        lead_filters: Dict[str, Any],
    ) -> tuple[List[UUID], Dict[str, List[Dict[str, Any]]]]:
        credit_min = lead_filters.get("credit_min")
        credit_max = lead_filters.get("credit_max")
        exclude_stages = [s.lower() for s in (lead_filters.get("exclude_stages") or [])]
        include_stages = [s.lower() for s in (lead_filters.get("include_stages") or [])]
        pool = lead_filters.get("pool")

        q = (
            select(Lead, Customer, LeadStage)
            .join(Customer, Lead.customer_id == Customer.id)
            .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
        )
        if pool == "mine":
            q = q.where(Lead.assigned_to == user.id)
        elif pool == "unassigned":
            q = q.where(Lead.assigned_to.is_(None))
        if pool != "mine" and accessible is not None:
            if not accessible:
                return [], {}
            q = q.where(or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None)))

        credit_clause = []
        if credit_min is not None:
            credit_clause.append(Customer.credit_score >= int(credit_min))
        if credit_max is not None:
            credit_clause.append(Customer.credit_score <= int(credit_max))
        if credit_clause:
            q = q.where(and_(*credit_clause))

        rows = (await db.execute(q.order_by(Lead.updated_at.desc()).limit(MAX_CANDIDATES))).all()

        snippets: Dict[str, List[Dict[str, Any]]] = {}
        ids: List[UUID] = []
        field_ids: set[UUID] = set()
        for lead, customer, stage in rows:
            if not cls._stage_allowed(stage, lead, exclude_stages, include_stages):
                continue
            ids.append(lead.id)
            field_ids.add(lead.id)
            if customer.credit_score:
                snippets[str(lead.id)] = [
                    {
                        "activity_type": "credit_score",
                        "activity_label": "Credit score",
                        "snippet": f"On-file credit score {customer.credit_score}",
                    }
                ]

        # Notes that mention a qualifying score but have no credit_score field
        if credit_min is not None or credit_max is not None:
            note_q = (
                select(Lead, Customer, LeadStage)
                .join(Customer, Lead.customer_id == Customer.id)
                .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
                .where(Lead.notes.isnot(None))
                .where(
                    or_(
                        Lead.notes.ilike("%credit%"),
                        Lead.notes.ilike("%fico%"),
                        Lead.notes.ilike("%score%"),
                    )
                )
            )
            if pool == "mine":
                note_q = note_q.where(Lead.assigned_to == user.id)
            elif pool == "unassigned":
                note_q = note_q.where(Lead.assigned_to.is_(None))
            if pool != "mine" and accessible is not None and accessible:
                note_q = note_q.where(
                    or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None))
                )
            for lead, customer, stage in (await db.execute(note_q)).all():
                if lead.id in field_ids:
                    continue
                if not cls._stage_allowed(stage, lead, exclude_stages, include_stages):
                    continue
                mentioned = extract_mentioned_credit(lead.notes or "")
                if mentioned is None:
                    continue
                if credit_min is not None and mentioned < int(credit_min):
                    continue
                if credit_max is not None and mentioned > int(credit_max):
                    continue
                ids.append(lead.id)
                shown = (lead.notes or "").strip()
                snippets[str(lead.id)] = [
                    {
                        "activity_type": "lead_notes",
                        "activity_label": "Lead notes",
                        "snippet": (shown[:217] + "...") if len(shown) > 220 else shown,
                    }
                ]

        return ids, snippets

    @staticmethod
    def _stage_allowed(
        stage: Optional[LeadStage],
        lead: Lead,
        exclude_stages: List[str],
        include_stages: List[str],
    ) -> bool:
        name = (stage.name if stage else "") or ""
        display = (stage.display_name if stage else "") or ""
        outcome = (lead.outcome or "").lower()
        hay = f"{name} {display} {outcome}".lower()
        if include_stages and not any(s in hay for s in include_stages):
            return False
        if exclude_stages and any(s in hay for s in exclude_stages):
            return False
        if exclude_stages and any(s in ("sold", "converted") for s in exclude_stages) and outcome == "converted":
            return False
        return True

    @classmethod
    async def _search_azure_or_notes(
        cls,
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        query_text: str,
        lead_filters: Dict[str, Any],
    ) -> tuple[List[UUID], Dict[str, List[Dict[str, Any]]], bool]:
        if not CrmContentSearchService.is_azure_configured():
            return [], {}, False
        search_text = (query_text or "").strip() or "*"
        if lead_filters.get("credit_min") is not None or lead_filters.get("credit_max") is not None:
            tokens = extract_search_tokens(search_text)
            if not [t for t in tokens if t not in _FILTER_STOPWORDS and not t.isdigit()]:
                search_text = "*"
        try:
            result = await CrmContentSearchService.search(
                db,
                user,
                query=search_text,
                pool=lead_filters.get("pool"),
                credit_min=lead_filters.get("credit_min"),
                credit_max=lead_filters.get("credit_max"),
                exclude_stages=lead_filters.get("exclude_stages"),
                include_stages=lead_filters.get("include_stages"),
                limit=NOTE_HIT_LIMIT,
            )
        except Exception:
            logger.exception("Azure AI Search request failed")
            return [], {}, False
        if result.get("backend") != "azure":
            return [], {}, False
        ids: List[UUID] = []
        snippets: Dict[str, List[Dict[str, Any]]] = {}
        seen: set[str] = set()
        for group in result.get("grouped_leads") or []:
            lid = group.get("lead_id")
            if not lid or lid in seen:
                continue
            seen.add(lid)
            try:
                ids.append(UUID(lid))
            except (TypeError, ValueError):
                continue
            snippets[lid] = group.get("snippets") or []
        return ids, snippets, True

    @classmethod
    async def _search_notes(
        cls,
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        content_query: str,
        *,
        pool: Optional[str],
    ) -> tuple[List[UUID], Dict[str, List[Dict[str, Any]]]]:
        groups = expand_meaning_terms(content_query)
        terms = flatten_terms(groups)
        if not terms:
            return [], {}

        meta = Activity.meta_data
        text_cols = [
            Activity.description,
            meta["content"].astext,
            meta["body_preview"].astext,
            meta["body"].astext,
            meta["subject"].astext,
            meta["notes"].astext,
            meta["message"].astext,
            Lead.notes,
            Lead.interested_in,
            Lead.interested_brand,
        ]

        def matches_term(term: str):
            like = f"%{term}%"
            return or_(*[col.ilike(like) for col in text_cols])

        def matches_all_groups():
            return and_(*[or_(*[matches_term(term) for term in group]) for group in groups])

        def matches_any_term():
            return or_(*[matches_term(term) for term in terms])

        q = (
            select(Activity, Lead, Customer, LeadStage)
            .join(Lead, Activity.lead_id == Lead.id)
            .join(Customer, Lead.customer_id == Customer.id)
            .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
            .where(Activity.lead_id.isnot(None))
            .where(matches_all_groups() if len(groups) > 1 else matches_any_term())
            .order_by(Activity.created_at.desc())
            .limit(NOTE_HIT_LIMIT)
        )
        if pool == "mine":
            q = q.where(Lead.assigned_to == user.id)
        elif pool == "unassigned":
            q = q.where(Lead.assigned_to.is_(None))
        if pool != "mine" and accessible is not None:
            if not accessible:
                return [], {}
            q = q.where(or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None)))

        rows = (await db.execute(q)).all()
        if not rows and len(groups) > 1:
            q = (
                select(Activity, Lead, Customer, LeadStage)
                .join(Lead, Activity.lead_id == Lead.id)
                .join(Customer, Lead.customer_id == Customer.id)
                .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
                .where(Activity.lead_id.isnot(None))
                .where(matches_any_term())
                .order_by(Activity.created_at.desc())
                .limit(NOTE_HIT_LIMIT)
            )
            if pool == "mine":
                q = q.where(Lead.assigned_to == user.id)
            elif pool == "unassigned":
                q = q.where(Lead.assigned_to.is_(None))
            if pool != "mine" and accessible is not None and accessible:
                q = q.where(or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None)))
            rows = (await db.execute(q)).all()
        snippets_by_lead: Dict[str, List[Dict[str, Any]]] = {}
        scores: Dict[UUID, int] = {}

        for activity, lead, customer, stage in rows:
            blob = " ".join(
                str(p)
                for p in (
                    (activity.meta_data or {}).get("content"),
                    activity.description,
                    lead.notes,
                    lead.interested_in,
                    lead.interested_brand,
                )
                if p
            ).lower()
            score = _meaning_score(blob, groups)
            if score <= 0:
                continue
            lid = lead.id
            scores[lid] = max(scores.get(lid, 0), score)
            snippet = (activity.meta_data or {}).get("content") or activity.description or lead.notes or ""
            snippet = str(snippet).strip()
            if len(snippet) > 220:
                snippet = snippet[:217] + "..."
            snippets_by_lead.setdefault(str(lid), []).append(
                {
                    "activity_id": str(activity.id),
                    "activity_type": getattr(activity.type, "value", str(activity.type)),
                    "activity_label": str(getattr(activity.type, "value", activity.type)).replace("_", " ").title(),
                    "created_at": activity.created_at.isoformat() if activity.created_at else "",
                    "snippet": snippet,
                }
            )

        # Lead.notes that never produced an activity hit
        lead_q = (
            select(Lead, Customer, LeadStage)
            .join(Customer, Lead.customer_id == Customer.id)
            .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
            .where(or_(*[Lead.notes.ilike(f"%{t}%") for t in terms]))
            .order_by(Lead.updated_at.desc())
            .limit(40)
        )
        if pool == "mine":
            lead_q = lead_q.where(Lead.assigned_to == user.id)
        elif pool == "unassigned":
            lead_q = lead_q.where(Lead.assigned_to.is_(None))
        if pool != "mine" and accessible is not None:
            if accessible:
                lead_q = lead_q.where(or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None)))
            else:
                lead_q = lead_q.where(Lead.id.is_(None))

        for lead, customer, stage in (await db.execute(lead_q)).all():
            note = (lead.notes or "").strip()
            score = _meaning_score(note.lower(), groups)
            if score <= 0:
                continue
            scores[lead.id] = max(scores.get(lead.id, 0), score)
            if str(lead.id) not in snippets_by_lead:
                shown = note[:217] + "..." if len(note) > 220 else note
                snippets_by_lead[str(lead.id)] = [
                    {
                        "activity_type": "lead_notes",
                        "activity_label": "Lead notes",
                        "snippet": shown,
                    }
                ]

        ordered_ids = [lid for lid, _ in sorted(scores.items(), key=lambda x: -x[1])]
        return ordered_ids, snippets_by_lead

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
        if contact_search:
            from app.api.v1.endpoints.leads import _phone_digit_variants, _sanitize_like

            raw = _sanitize_like(contact_search.strip())
            digits = re.sub(r"\D", "", raw)
            phone_digits = func.regexp_replace(func.coalesce(Customer.phone, ""), r"[^0-9]", "", "g")
            full_name = func.concat(Customer.first_name, " ", func.coalesce(Customer.last_name, ""))
            prefix_phone = []
            if len(digits) >= 3:
                for v in _phone_digit_variants(digits):
                    prefix_phone.extend(
                        [
                            phone_digits.like(f"{v}%"),
                            phone_digits.like(f"91{v}%"),
                            phone_digits.like(f"1{v}%"),
                            phone_digits.like(f"0{v}%"),
                        ]
                    )
            rank_whens = [
                (Customer.first_name.ilike(f"{raw}%"), 0),
                (Customer.last_name.ilike(f"{raw}%"), 0),
                (full_name.ilike(f"{raw}%"), 1),
            ]
            if prefix_phone:
                rank_whens.append((or_(*prefix_phone), 1))
            rank = case(*rank_whens, else_=2)
            query = query.order_by(rank, Lead.updated_at.desc()).limit(MAX_CANDIDATES)
        else:
            query = query.order_by(Lead.updated_at.desc()).limit(MAX_CANDIDATES)

        # IDs only — loading full Lead rows also pulls customer/stage joins.
        id_query = query.with_only_columns(Lead.id, maintain_column_froms=True)
        rows = (await db.execute(id_query)).all()
        return [row[0] for row in rows]

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

        rows = (
            await db.execute(
                select(Lead, Customer, LeadStage)
                .join(Customer, Lead.customer_id == Customer.id)
                .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
                .where(Lead.id.in_(list(lead_ids)))
            )
        ).all()
        by_id = {lead.id: (lead, customer, stage) for lead, customer, stage in rows}

        activity = intent.get("activity") or {}
        out: List[Dict[str, Any]] = []
        for lid_uuid in lead_ids:
            packed = by_id.get(lid_uuid)
            if not packed:
                continue
            lead, customer, stage = packed
            lid = str(lead.id)
            name = f"{customer.first_name or ''} {customer.last_name or ''}".strip() or "Unknown"
            source = None
            if isinstance(lead.source, str):
                source = lead.source
            else:
                source = getattr(lead.source, "value", None)
            meta = lead.meta_data or {}
            source = meta.get("source_display") or source

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
            credit_min = (intent.get("lead") or {}).get("credit_min")
            if customer.credit_score and credit_min is not None:
                reasons.append(f"Credit score {customer.credit_score}")
            snippets = snippets_by_lead.get(lid) or []
            if snippets:
                reasons.append("Mentioned in notes or activity")

            out.append(
                {
                    "id": lid,
                    "name": name,
                    "phone": customer.phone,
                    "email": customer.email,
                    "stage": getattr(stage, "display_name", None) or getattr(stage, "name", None),
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
