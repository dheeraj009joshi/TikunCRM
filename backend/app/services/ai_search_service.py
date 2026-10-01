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
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
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
from app.services.crm_content_search_service import (
    CrmContentSearchService,
    extract_mentioned_credit,
    extract_mentioned_down,
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
    r"(?:more\s+th[ae]n|over|above|greater\s+than|at\s+least|minimum|>=|>)\s*(\d{3,4})\s*(?:\+)?\s*(?:credit|fico|score)\b"
    r"|(?:credit|fico|score)\s*(?:of\s+|is\s+|over\s+|above\s+|more\s+th[ae]n\s+|at\s+least\s+)?(\d{3,4})"
    r"|(\d{3,4})\s*(?:\+)?\s*(?:credit|fico|score)\b",
    re.I,
)
_CREDIT_UNDER_RE = re.compile(
    r"(?:less\s+th[ae]n|under|below|at\s+most|no\s+more\s+th[ae]n|<=|<)\s*(\d{3,4})\s*(?:\+)?\s*(?:credit|fico|score)\b",
    re.I,
)
_DOWN_OVER_RE = re.compile(
    r"(?:down\s*payments?|cash\s*down|\bdown\b)\s*(?:of\s+|is\s+|at\s+)?"
    r"(?:more\s+th[ae]n|over|above|greater\s+than|at\s+least|minimum|>=|>)?\s*"
    r"\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})"
    r"|(?:more\s+th[ae]n|over|above|greater\s+than|at\s+least|minimum|>=|>)\s*"
    r"\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:\+)?\s*(?:down\s*payments?|cash\s*down|\bdown\b)",
    re.I,
)
_DOWN_UNDER_RE = re.compile(
    r"(?:down\s*payments?|cash\s*down|\bdown\b)\s*(?:of\s+|is\s+)?"
    r"(?:less\s+th[ae]n|under|below|at\s+most|<=|<)\s*"
    r"\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})"
    r"|(?:less\s+th[ae]n|under|below|at\s+most|<=|<)\s*"
    r"\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:\+)?\s*(?:down\s*payments?|cash\s*down|\bdown\b)",
    re.I,
)
_EXCLUDE_STATUS_RE = re.compile(
    r"(?:status|stage)s?\s+(?:is\s+|are\s+)?not\s+(.+?)(?=\s+and\s+(?:has|have|with|credit|down|fico)|$)",
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


FILTER_FIELDS = frozenset(
    {
        "credit_score",
        "down_payment",
        "stage",
        "outcome",
        "source",
        "has_ssn_stip",
        "has_dl_stip",
        "has_license",
        "is_active",
        "pool",
        "interested_in",
        "interested_brand",
        "created_days",
        "is_business",
    }
)
FILTER_OPS = frozenset({"eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains"})
_FIELD_HINTS: List[tuple] = [
    (re.compile(r"credit|fico|score", re.I), "credit_score"),
    (re.compile(r"down\s*payments?|downpayment|cash\s*down|\bdown\b", re.I), "down_payment"),
    (re.compile(r"status|stage", re.I), "stage"),
    (re.compile(r"source|campaign", re.I), "source"),
    (re.compile(r"ssn|social", re.I), "has_ssn_stip"),
    (re.compile(r"\bdl\b|license|driver", re.I), "has_dl_stip"),
    (re.compile(r"brand|toyota|ford|honda|chevrolet", re.I), "interested_brand"),
    (re.compile(r"interest(?:ed)?\s+in|vehicle|car|truck|suv", re.I), "interested_in"),
]
_CMP_RE = re.compile(
    r"(.{0,40}?)(?:more\s+th[ae]n|over|above|greater\s+than|at\s+least|minimum|less\s+th[ae]n|under|below|at\s+most)\s+\$?([\d,]+)\s*(.{0,40})",
    re.I,
)
_INTENT_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
_INTENT_CACHE_TTL = 120.0


def _parse_number(raw: Any) -> Optional[float]:
    if raw is None or raw is False:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).replace(",", "").replace("$", "").strip()
    try:
        return float(text)
    except ValueError:
        return None


def _field_from_text(text: str) -> Optional[str]:
    for pattern, field in _FIELD_HINTS:
        if pattern.search(text or ""):
            return field
    return None


def extract_dynamic_filters(query: str) -> List[Dict[str, Any]]:
    """Build filters from the words sitting next to comparisons in this question."""
    raw = query or ""
    lower = raw.lower()
    filters: List[Dict[str, Any]] = []

    for match in _CMP_RE.finditer(raw):
        before, number, after = match.groups()
        amount = _parse_number(number)
        if amount is None:
            continue
        field = _field_from_text(f"{before} {after}")
        if not field:
            continue
        cmp = match.group(0).lower()
        if re.search(r"less\s+th[ae]n|under|below|at\s+most", cmp):
            op = "lt"
        elif re.search(r"at\s+least|minimum", cmp):
            op = "gte"
        else:
            op = "gt"
        filters.append({"field": field, "op": op, "value": amount})

    status_not = _EXCLUDE_STATUS_RE.search(raw)
    if status_not:
        stages = _normalize_stage_tokens(status_not.group(1))
        if stages:
            filters.append({"field": "stage", "op": "not_in", "value": stages})
    elif re.search(r"\bnot\s+sold\b|\bnot\s+converted\b|\bexcluding\s+(?:sold|converted)", lower):
        filters.append({"field": "stage", "op": "not_in", "value": ["sold", "converted"]})

    return _normalize_filters(filters)


def _normalize_filters(raw_filters: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(raw_filters, list):
        return out
    for item in raw_filters:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip().lower()
        op = str(item.get("op") or "").strip().lower()
        if field not in FILTER_FIELDS or op not in FILTER_OPS:
            continue
        value = item.get("value")
        if field in {"credit_score", "down_payment", "created_days"}:
            if op in {"in", "not_in"}:
                value = [_parse_number(v) for v in (value if isinstance(value, list) else [value])]
                value = [v for v in value if v is not None]
            else:
                value = _parse_number(value)
            if value is None or value == []:
                continue
        elif field == "stage":
            if not isinstance(value, list):
                value = _normalize_stage_tokens(str(value))
            else:
                value = _normalize_stage_tokens(" or ".join(str(v) for v in value))
            if not value:
                continue
        elif field in {"has_ssn_stip", "has_dl_stip", "has_license", "is_active", "is_business"}:
            value = bool(value)
        out.append({"field": field, "op": op, "value": value})
    return out


def _lead_from_filters(filters: List[Dict[str, Any]]) -> Dict[str, Any]:
    lead: Dict[str, Any] = {}
    for item in filters:
        field, op, value = item["field"], item["op"], item["value"]
        if field == "credit_score" and op in {"gt", "gte"}:
            lead["credit_min"] = int(value)
        elif field == "credit_score" and op in {"lt", "lte"}:
            lead["credit_max"] = int(value)
        elif field == "down_payment" and op in {"gt", "gte"}:
            lead["down_min"] = float(value)
        elif field == "down_payment" and op in {"lt", "lte"}:
            lead["down_max"] = float(value)
        elif field == "stage" and op == "not_in":
            lead["exclude_stages"] = list(value)
        elif field == "stage" and op in {"in", "eq"}:
            lead["include_stages"] = value if isinstance(value, list) else [value]
        elif field == "pool" and value in {"mine", "unassigned"}:
            lead["pool"] = value
        elif field in {"has_ssn_stip", "has_dl_stip", "fresh_only", "is_active"}:
            lead[field] = bool(value)
        elif field == "created_days":
            lead["created_days"] = int(value)
        elif field == "source":
            lead["source"] = str(value)
    return lead


def _content_query_without_filters(query: str, filters: List[Dict[str, Any]]) -> Optional[str]:
    used = {item["field"] for item in filters}
    skip = set(_FILTER_STOPWORDS)
    if "down_payment" in used:
        skip.update({"down", "downpayment", "payment", "cash"})
    if "credit_score" in used:
        skip.update({"credit", "fico", "score"})
    if "stage" in used:
        skip.update({"status", "stage", "sold", "converted", "lost"})
    tokens = [
        t for t in extract_search_tokens(query)
        if t not in skip and not t.isdigit()
    ]
    return " ".join(tokens) if tokens else None


def _describe_filters(filters: List[Dict[str, Any]]) -> str:
    labels = {
        "credit_score": "credit score",
        "down_payment": "down payment",
        "stage": "stage",
        "outcome": "outcome",
        "source": "source",
        "interested_in": "interest",
        "interested_brand": "brand",
    }
    symbols = {"gt": ">", "gte": "≥", "lt": "<", "lte": "≤", "eq": "=", "ne": "≠"}
    bits: List[str] = []
    for item in filters:
        name = labels.get(item["field"], item["field"].replace("_", " "))
        op, value = item["op"], item["value"]
        if op == "not_in":
            shown = " and ".join(str(v).replace("_", " ").title() for v in value)
            bits.append(f"excluding {shown}")
        elif op == "in":
            shown = " or ".join(str(v).replace("_", " ") for v in value)
            bits.append(f"{name} is {shown}")
        elif op == "contains":
            bits.append(f"{name} contains {value}")
        elif item["field"] == "down_payment":
            bits.append(f"{name} {symbols.get(op, op)} ${int(float(value)):,}")
        else:
            bits.append(f"{name} {symbols.get(op, op)} {value}")
    return ", ".join(bits)


def _lead_field_value(lead: Lead, customer: Customer, stage: Optional[LeadStage], field: str) -> Any:
    if field == "credit_score":
        if customer and customer.credit_score:
            return float(customer.credit_score)
        return extract_mentioned_credit(lead.notes or "")
    if field == "down_payment":
        if lead.down_payment is not None:
            return float(lead.down_payment)
        meta = lead.meta_data or {}
        raw = meta.get("downpayment") or meta.get("down_payment")
        parsed = _parse_number(raw)
        if parsed is not None:
            return parsed
        return extract_mentioned_down(lead.notes or "")
    if field == "stage":
        return f"{getattr(stage, 'name', '') or ''} {getattr(stage, 'display_name', '') or ''} {lead.outcome or ''}".lower()
    if field == "outcome":
        return (lead.outcome or "").lower()
    if field == "source":
        meta = lead.meta_data or {}
        return str(meta.get("source_display") or getattr(lead.source, "value", lead.source) or "").lower()
    if field == "has_ssn_stip":
        return bool(lead.has_ssn_stip)
    if field == "has_dl_stip":
        return bool(lead.has_dl_stip)
    if field == "has_license":
        return bool(getattr(customer, "has_license", None))
    if field == "is_active":
        return bool(lead.is_active)
    if field == "is_business":
        return lead.is_business
    if field == "interested_in":
        return (lead.interested_in or "").lower()
    if field == "interested_brand":
        return (lead.interested_brand or "").lower()
    if field == "created_days":
        created = lead.created_at
        if not created:
            return None
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - created).days
    return None


def _compare(actual: Any, op: str, expected: Any) -> bool:
    if actual is None:
        return False
    if op in {"in", "not_in"}:
        values = [str(v).lower() for v in (expected or [])]
        hay = str(actual).lower()
        hit = any(v in hay for v in values)
        return (not hit) if op == "not_in" else hit
    if op == "contains":
        return str(expected).lower() in str(actual).lower()
    if op in {"gt", "gte", "lt", "lte"}:
        left = _parse_number(actual)
        right = _parse_number(expected)
        if left is None or right is None:
            return False
        if op == "gt":
            return left > right
        if op == "gte":
            return left >= right
        if op == "lt":
            return left < right
        return left <= right
    if op == "ne":
        return str(actual).lower() != str(expected).lower()
    return str(actual).lower() == str(expected).lower()


def lead_matches_filters(
    lead: Lead,
    customer: Customer,
    stage: Optional[LeadStage],
    filters: List[Dict[str, Any]],
) -> bool:
    return all(
        _compare(_lead_field_value(lead, customer, stage, item["field"]), item["op"], item["value"])
        for item in filters
        if item["field"] != "pool"
    )


def _empty_intent(query: str) -> Dict[str, Any]:
    return {
        "interpretation": query.strip(),
        "contact_search": None,
        "content_query": None,
        "activity": None,
        "lead": {},
        "filters": [],
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

    filters = extract_dynamic_filters(raw)
    intent["filters"] = filters
    if filters:
        intent["lead"].update(_lead_from_filters(filters))

    find_someone = any(
        p in lower
        for p in (
            "who has", "who have", "customer who", "lead who", "someone",
            "find", "show me", "looking for", "want the", "wants the",
            "mention", "notes", "said",
        )
    ) or "?" in raw
    leftover = _content_query_without_filters(raw, filters)
    if leftover and not intent["activity"] and not filters:
        intent["content_query"] = leftover
    elif leftover and find_someone and not intent["activity"] and not filters:
        intent["content_query"] = leftover

    if "unassigned" in lower:
        intent["lead"]["pool"] = "unassigned"
    elif "my lead" in lower or "assigned to me" in lower:
        intent["lead"]["pool"] = "mine"
    if "ssn" in lower:
        intent["lead"]["has_ssn_stip"] = True
        intent["filters"].append({"field": "has_ssn_stip", "op": "eq", "value": True})
    if "fresh" in lower:
        intent["lead"]["fresh_only"] = True

    described = _describe_filters(intent["filters"])
    if described:
        intent["interpretation"] = described[0].upper() + described[1:]
    elif leftover and find_someone and not intent["activity"]:
        intent["content_query"] = leftover
        intent["interpretation"] = f"Notes or activity about {leftover}"

    if not intent["contact_search"] and not intent["content_query"] and not intent["activity"] and not intent["lead"] and not intent["filters"]:
        tokens = extract_search_tokens(raw)
        intent["contact_search"] = raw if _looks_like_contact(raw) else None
        intent["content_query"] = " ".join(tokens) if tokens else raw
        intent["interpretation"] = f"Leads or notes matching {intent['content_query']}"

    return intent


_LLM_SYSTEM = """You convert a CRM search question into a JSON query plan.
Available fields: credit_score, down_payment, stage, outcome, source, has_ssn_stip, has_dl_stip, has_license, is_active, pool, interested_in, interested_brand, created_days, is_business.
Ops: eq, ne, gt, gte, lt, lte, in, not_in, contains.
Rules:
- Form filters from THIS question only. Do not assume extra constraints.
- "more than 5000 down payment" → {field: down_payment, op: gt, value: 5000}
- "more than 600 credit" → {field: credit_score, op: gte, value: 600}
- "status not sold or converted" → {field: stage, op: not_in, value: ["sold","converted"]}
- sold means converted/sold.
- 5,000 means 5000.
- content_query is ONLY leftover note-meaning that is not a structured field. Never put down payment or credit into content_query.
- contact_search only for name/phone/email lookups.
- activity only for frequency questions (called 3 times in 7 days).
Return JSON: {interpretation, contact_search, content_query, activity, filters:[{field,op,value}]}"""


async def llm_intent(query: str) -> Optional[Dict[str, Any]]:
    if not settings.openai_api_key:
        return None
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=6.0)
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _LLM_SYSTEM},
            {"role": "user", "content": query},
        ],
    )
    text = (response.choices[0].message.content or "").strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        return None
    intent = _empty_intent(query)
    intent["interpretation"] = str(data.get("interpretation") or "").strip() or query
    intent["contact_search"] = (str(data["contact_search"]).strip() or None) if data.get("contact_search") else None
    intent["content_query"] = (str(data["content_query"]).strip() or None) if data.get("content_query") else None
    intent["filters"] = _normalize_filters(data.get("filters"))
    if intent["filters"]:
        intent["lead"].update(_lead_from_filters(intent["filters"]))
        described = _describe_filters(intent["filters"])
        if described:
            intent["interpretation"] = described[0].upper() + described[1:]
    activity = data.get("activity")
    if isinstance(activity, dict) and any(activity.get(k) for k in ("types", "min_count", "days", "no_activity")):
        intent["activity"] = {
            "types": _normalize_activity_types(activity.get("types")),
            "min_count": _as_int(activity.get("min_count")),
            "days": _as_int(activity.get("days")) or 7,
            "no_activity": bool(activity.get("no_activity")),
        }
    intent["parsed_by"] = "ai"
    return intent


async def interpret_query(query: str, user: User) -> Dict[str, Any]:
    raw = (query or "").strip()
    if _looks_like_contact(raw):
        intent = heuristic_intent(raw)
        intent["parsed_by"] = "heuristic"
        return intent

    cache_key = raw.lower()
    cached = _INTENT_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _INTENT_CACHE_TTL:
        return cached[1]

    intent = None
    try:
        intent = await llm_intent(raw)
    except Exception:
        logger.warning("Search query planner failed; using local parse", exc_info=True)
    if not intent or (not intent.get("filters") and not intent.get("activity") and not intent.get("contact_search") and not intent.get("content_query")):
        fallback = heuristic_intent(raw)
        fallback["parsed_by"] = "heuristic"
        intent = fallback
    _INTENT_CACHE[cache_key] = (time.time(), intent)
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
                "down_min": lead.get("down_min"),
                "down_max": lead.get("down_max"),
                "exclude_stages": lead.get("exclude_stages") or None,
                "include_stages": lead.get("include_stages") or None,
            }.items()
            if v is not None
        }
    if data.get("filters"):
        intent["filters"] = _normalize_filters(data.get("filters"))
        if intent["filters"]:
            intent["lead"].update(_lead_from_filters(intent["filters"]))

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
        filters = intent.get("filters") or []
        if not filters:
            filters = extract_dynamic_filters(q)
            if filters:
                intent["filters"] = filters
                lead_filters.update(_lead_from_filters(filters))
                intent["lead"] = lead_filters
        has_structured = bool(filters)
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
                db, user, accessible, lead_filters, filters
            )
            snippets_by_lead.update(note_snips)
            if base_ids:
                allowed = set(structured_ids)
                base_ids = [lid for lid in base_ids if lid in allowed]
            else:
                base_ids = structured_ids
            backend_used = "structured"

        if content_query:
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
                "filters": intent.get("filters") or [],
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
        filters: Optional[List[Dict[str, Any]]] = None,
    ) -> tuple[List[UUID], Dict[str, List[Dict[str, Any]]]]:
        filters = filters or []
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

        rows = (await db.execute(q.order_by(Lead.updated_at.desc()).limit(2000))).all()
        ids: List[UUID] = []
        snippets: Dict[str, List[Dict[str, Any]]] = {}
        for lead, customer, stage in rows:
            if filters and not lead_matches_filters(lead, customer, stage, filters):
                continue
            ids.append(lead.id)
            reasons: List[Dict[str, Any]] = []
            credit = _lead_field_value(lead, customer, stage, "credit_score")
            down = _lead_field_value(lead, customer, stage, "down_payment")
            if any(f["field"] == "credit_score" for f in filters) and credit:
                reasons.append(
                    {
                        "activity_type": "credit_score",
                        "activity_label": "Credit score",
                        "snippet": f"Credit score {int(credit)}",
                    }
                )
            if any(f["field"] == "down_payment" for f in filters) and down:
                reasons.append(
                    {
                        "activity_type": "down_payment",
                        "activity_label": "Down payment",
                        "snippet": f"Down payment ${int(down):,}",
                    }
                )
            if reasons:
                snippets[str(lead.id)] = reasons
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
            down_min = (intent.get("lead") or {}).get("down_min")
            down_val = _lead_field_value(lead, customer, stage, "down_payment")
            if down_min is not None and down_val is not None:
                reasons.append(f"Down payment ${int(down_val):,}")
            snippets = snippets_by_lead.get(lid) or []
            if snippets and any(
                (s.get("activity_type") or "") not in {"credit_score", "down_payment"}
                for s in snippets
            ):
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
