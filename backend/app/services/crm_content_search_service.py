"""
CRM content search — notes, calls, SMS, WhatsApp, and emails across leads.

Uses Azure AI Search when configured; falls back to PostgreSQL ILIKE so dev/local
environments still work without Azure.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Set
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access_scope import get_accessible_dealership_ids
from app.core.config import settings
from app.core.permissions import UserRole
from app.models.activity import Activity, ActivityType
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_stage import LeadStage
from app.models.user import User

logger = logging.getLogger(__name__)

INDEXABLE_ACTIVITY_TYPES: Set[ActivityType] = {
    ActivityType.NOTE_ADDED,
    ActivityType.CALL_LOGGED,
    ActivityType.EMAIL_SENT,
    ActivityType.EMAIL_RECEIVED,
    ActivityType.SMS_SENT,
    ActivityType.SMS_RECEIVED,
    ActivityType.WHATSAPP_SENT,
    ActivityType.WHATSAPP_RECEIVED,
    ActivityType.STATUS_CHANGED,
    ActivityType.FOLLOW_UP_SCHEDULED,
    ActivityType.FOLLOW_UP_COMPLETED,
    ActivityType.FOLLOW_UP_MISSED,
}

_STOPWORDS = frozenset(
    {
        "the", "and", "for", "that", "this", "with", "from", "have", "has",
        "was", "were", "are", "about", "into", "your", "their", "they", "them",
        "who", "what", "when", "where", "which", "will", "would", "could",
        "should", "been", "being", "also", "just", "like", "lead", "leads",
    }
)

CONTENT_QUERY_RE = re.compile(
    r"\b("
    r"said|mention|noted?|notes?|talked|discussed|asked|wants?|looking|"
    r"trade|financ|credit|vehicle|car|truck|suv|appointment|callback|called|"
    r"message|texted|whatsapp|email|voicemail|timeline|activity|activities|"
    r"communicat|conversation|promised|complain|ready to buy|hot lead"
    r")\b",
    re.I,
)


def is_indexable_activity(activity_type: ActivityType) -> bool:
    return activity_type in INDEXABLE_ACTIVITY_TYPES


def _parse_activity_types(values: Optional[List[str]]) -> Optional[List[ActivityType]]:
    if not values:
        return None
    out: List[ActivityType] = []
    for raw in values:
        try:
            out.append(ActivityType(raw))
        except ValueError:
            continue
    return out or None


def should_auto_retrieve_crm_content(user_text: str) -> bool:
    """True when the user message likely needs note/activity search (not pure filters)."""
    t = user_text.strip()
    if not t or len(t) < 3:
        return False
    lower = t.lower()
    if re.search(r"\b(ssn stip|dl stip|has_ssn|has_dl|down payment|down_min|stips only)\b", lower):
        if not CONTENT_QUERY_RE.search(t):
            return False
    return bool(CONTENT_QUERY_RE.search(t) or "?" in t)


def extract_activity_content(activity: Activity) -> str:
    """Build searchable plain text from an activity row."""
    meta = activity.meta_data or {}
    parts: List[str] = [activity.description or ""]

    if activity.type == ActivityType.NOTE_ADDED:
        parts.append(str(meta.get("content") or ""))
    elif activity.type in (
        ActivityType.SMS_SENT,
        ActivityType.SMS_RECEIVED,
        ActivityType.WHATSAPP_SENT,
        ActivityType.WHATSAPP_RECEIVED,
    ):
        parts.append(str(meta.get("body_preview") or meta.get("body") or meta.get("message") or ""))
    elif activity.type in (ActivityType.EMAIL_SENT, ActivityType.EMAIL_RECEIVED):
        parts.append(str(meta.get("subject") or ""))
        parts.append(str(meta.get("body_preview") or meta.get("body") or meta.get("snippet") or ""))
    elif activity.type == ActivityType.CALL_LOGGED:
        parts.append(str(meta.get("notes") or meta.get("summary") or ""))
        parts.append(str(meta.get("call_outcome") or meta.get("outcome") or ""))
    elif activity.type == ActivityType.STATUS_CHANGED:
        parts.append(str(meta.get("notes") or ""))
        parts.append(f"{meta.get('old_status', '')} {meta.get('new_status', '')}")
    else:
        for key in ("content", "notes", "message", "body", "body_preview", "subject"):
            val = meta.get(key)
            if val:
                parts.append(str(val))

    return " ".join(p.strip() for p in parts if p and str(p).strip())


_CREDIT_WORD_RE = re.compile(r"credit|fico|score", re.I)
_CREDIT_RANGE_RE = re.compile(
    r"(?<![\d,])([3-8]\d{2})\s*[-–/to]+\s*([3-8]\d{2}|850)(?!\d)",
    re.I,
)
_CREDIT_SCORE_RE = re.compile(r"(?<![\d,])([3-8]\d{2}|850)(?!\d)")
_CREDIT_BUCKET_RE = re.compile(r"(?<![\d,])([3-8]\d{2})s\b", re.I)


_DOWN_MENTION_RE = re.compile(
    r"(?:\$\s*)?(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:\+)?\s*(?:down\b|cash\s*down)"
    r"|(?:down\s*payments?|cash\s*down)\s*(?:of\s+|is\s+|at\s+)?(?:\$\s*)?(\d{1,3}(?:,\d{3})+|\d{3,6})",
    re.I,
)


def extract_mentioned_down(text: str) -> Optional[float]:
    """Largest down-payment amount mentioned in notes (ignores credit scores)."""
    if not text:
        return None
    amounts: List[float] = []
    for left, right in _DOWN_MENTION_RE.findall(text):
        raw = left or right
        try:
            amounts.append(float(raw.replace(",", "")))
        except ValueError:
            continue
    return max(amounts) if amounts else None


def extract_mentioned_credit(text: str) -> Optional[int]:
    """Best credit/FICO number mentioned near the word credit (300–850)."""
    if not text or not _CREDIT_WORD_RE.search(text):
        return None
    scores: List[int] = []
    for left, right in _CREDIT_RANGE_RE.findall(text):
        scores.extend((int(left), int(right)))
    for match in _CREDIT_SCORE_RE.finditer(text):
        window = text[max(0, match.start() - 48) : match.end() + 48]
        if _CREDIT_WORD_RE.search(window):
            n = int(match.group(1))
            if 300 <= n <= 850:
                scores.append(n)
    for match in _CREDIT_BUCKET_RE.finditer(text):
        window = text[max(0, match.start() - 48) : match.end() + 48]
        if _CREDIT_WORD_RE.search(window):
            scores.append(int(match.group(1)))
    return max(scores) if scores else None


def extract_keywords(text: str, limit: int = 12) -> List[str]:
    words = re.findall(r"[a-zA-Z0-9]{3,}", (text or "").lower())
    seen: Set[str] = set()
    out: List[str] = []
    for w in words:
        if w in _STOPWORDS or w in seen:
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= limit:
            break
    return out


def _activity_type_label(activity_type: str) -> str:
    return (activity_type or "").replace("_", " ").title()


class CrmContentSearchService:
    """Search CRM timeline content with RBAC-aware filters."""

    _semantic_enabled = False

    @staticmethod
    def is_azure_configured() -> bool:
        return settings.is_azure_search_configured

    @staticmethod
    def is_available() -> bool:
        return True  # Postgres fallback always available

    # ------------------------------------------------------------------ Azure index
    @staticmethod
    def _azure_index_client():
        from azure.core.credentials import AzureKeyCredential
        from azure.search.documents.indexes import SearchIndexClient

        return SearchIndexClient(
            endpoint=settings.azure_search_endpoint,
            credential=AzureKeyCredential(settings.azure_search_api_key),
        )

    @staticmethod
    def _azure_search_client():
        from azure.core.credentials import AzureKeyCredential
        from azure.search.documents import SearchClient

        return SearchClient(
            endpoint=settings.azure_search_endpoint,
            index_name=settings.azure_search_index,
            credential=AzureKeyCredential(settings.azure_search_api_key),
        )

    @classmethod
    async def ensure_index(cls) -> bool:
        """Create or update the Azure Search index with filters + semantic ranker."""
        if not cls.is_azure_configured():
            return False
        try:
            from azure.search.documents.indexes.models import (
                SearchableField,
                SearchField,
                SearchFieldDataType,
                SearchIndex,
                SemanticConfiguration,
                SemanticField,
                SemanticPrioritizedFields,
                SemanticSearch,
                SimpleField,
            )

            fields = [
                SimpleField(name="id", type=SearchFieldDataType.String, key=True),
                SearchableField(
                    name="content",
                    type=SearchFieldDataType.String,
                    analyzer_name="en.microsoft",
                ),
                SearchableField(name="description", type=SearchFieldDataType.String),
                SearchableField(name="customer_name", type=SearchFieldDataType.String),
                SearchableField(name="interested_in", type=SearchFieldDataType.String),
                SearchableField(name="interested_brand", type=SearchFieldDataType.String),
                SearchableField(name="lead_notes", type=SearchFieldDataType.String),
                SearchableField(name="phone", type=SearchFieldDataType.String),
                SearchableField(name="email", type=SearchFieldDataType.String),
                SearchableField(
                    name="keywords",
                    type=SearchFieldDataType.Collection(SearchFieldDataType.String),
                ),
                SimpleField(
                    name="doc_type",
                    type=SearchFieldDataType.String,
                    filterable=True,
                    facetable=True,
                ),
                SimpleField(
                    name="activity_type",
                    type=SearchFieldDataType.String,
                    filterable=True,
                    facetable=True,
                ),
                SimpleField(name="lead_id", type=SearchFieldDataType.String, filterable=True),
                SimpleField(name="activity_id", type=SearchFieldDataType.String, filterable=True),
                SimpleField(
                    name="dealership_id",
                    type=SearchFieldDataType.String,
                    filterable=True,
                ),
                SimpleField(name="assigned_to", type=SearchFieldDataType.String, filterable=True),
                SimpleField(name="stage_name", type=SearchFieldDataType.String, filterable=True),
                SimpleField(name="stage_display", type=SearchFieldDataType.String, filterable=True),
                SimpleField(name="outcome", type=SearchFieldDataType.String, filterable=True),
                SimpleField(
                    name="credit_score",
                    type=SearchFieldDataType.Int32,
                    filterable=True,
                    sortable=True,
                ),
                SimpleField(
                    name="mentioned_credit_score",
                    type=SearchFieldDataType.Int32,
                    filterable=True,
                    sortable=True,
                ),
                SimpleField(
                    name="is_active",
                    type=SearchFieldDataType.Boolean,
                    filterable=True,
                ),
                SimpleField(name="phone_digits", type=SearchFieldDataType.String, filterable=True),
                SearchField(
                    name="created_at",
                    type=SearchFieldDataType.DateTimeOffset,
                    filterable=True,
                    sortable=True,
                ),
            ]
            semantic = SemanticSearch(
                configurations=[
                    SemanticConfiguration(
                        name="crm-semantic",
                        prioritized_fields=SemanticPrioritizedFields(
                            title_field=SemanticField(field_name="customer_name"),
                            content_fields=[
                                SemanticField(field_name="content"),
                                SemanticField(field_name="lead_notes"),
                                SemanticField(field_name="description"),
                            ],
                            keywords_fields=[SemanticField(field_name="keywords")],
                        ),
                    )
                ]
            )
            client = cls._azure_index_client()
            desired = {f.name: f for f in fields}
            try:
                current = client.get_index(settings.azure_search_index)
                existing_names = {f.name for f in current.fields}
                merged = list(current.fields)
                for name, field in desired.items():
                    if name not in existing_names:
                        merged.append(field)
                fields = merged
            except Exception:
                logger.info("Azure index %s does not exist yet; creating", settings.azure_search_index)
            try:
                client.create_or_update_index(
                    SearchIndex(
                        name=settings.azure_search_index,
                        fields=fields,
                        semantic_search=semantic,
                    )
                )
                cls._semantic_enabled = True
            except Exception as sem_err:
                logger.warning("Semantic ranker unavailable (%s); updating fields only", sem_err)
                client.create_or_update_index(
                    SearchIndex(name=settings.azure_search_index, fields=fields)
                )
                cls._semantic_enabled = False
            logger.info("Azure Search index ready: %s", settings.azure_search_index)
            return True
        except Exception:
            logger.exception("Failed to ensure Azure Search index")
            return False

    @classmethod
    async def build_document_for_activity(
        cls, db: AsyncSession, activity_id: UUID
    ) -> Optional[Dict[str, Any]]:
        row = await cls._load_activity_context(db, activity_id)
        if not row:
            return None
        return cls.document_from_activity(*row)

    @classmethod
    def document_from_activity(
        cls, activity: Activity, lead: Lead, customer: Customer, stage: Optional[LeadStage]
    ) -> Optional[Dict[str, Any]]:
        if not is_indexable_activity(activity.type) or not activity.lead_id:
            return None

        content = extract_activity_content(activity)
        if not content.strip():
            return None

        customer_name = customer.full_name if customer else ""
        created_at = activity.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        blob = " ".join(
            p for p in (content, lead.notes or "", lead.interested_in or "") if p
        )
        return cls._base_lead_fields(lead, customer, stage) | {
            "id": str(activity.id),
            "doc_type": "activity",
            "activity_id": str(activity.id),
            "activity_type": activity.type.value,
            "content": content,
            "description": activity.description or "",
            "customer_name": customer_name,
            "mentioned_credit_score": extract_mentioned_credit(blob) or 0,
            "created_at": created_at.isoformat() if created_at else None,
            "keywords": " ".join(extract_keywords(content)),
        }

    @classmethod
    def _base_lead_fields(cls, lead: Lead, customer: Optional[Customer], stage: Optional[LeadStage]) -> Dict[str, Any]:
        phone = (customer.phone if customer else None) or ""
        email = (customer.email if customer else None) or ""
        return {
            "lead_id": str(lead.id),
            "interested_in": lead.interested_in or "",
            "interested_brand": lead.interested_brand or "",
            "lead_notes": lead.notes or "",
            "phone": phone,
            "email": email,
            "phone_digits": re.sub(r"\D", "", phone),
            "dealership_id": str(lead.dealership_id) if lead.dealership_id else "",
            "assigned_to": str(lead.assigned_to) if lead.assigned_to else "",
            "stage_name": (stage.name if stage else "") or "",
            "stage_display": (stage.display_name if stage else "") or "",
            "outcome": lead.outcome or "",
            "credit_score": int(customer.credit_score) if customer and customer.credit_score else 0,
            "is_active": bool(lead.is_active),
        }

    @classmethod
    async def build_document_for_lead(
        cls, db: AsyncSession, lead_id: UUID
    ) -> Optional[Dict[str, Any]]:
        row = (
            await db.execute(
                select(Lead, Customer, LeadStage)
                .join(Customer, Lead.customer_id == Customer.id)
                .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
                .where(Lead.id == lead_id)
            )
        ).first()
        if not row:
            return None
        return cls.document_from_lead(*row)

    @classmethod
    def document_from_lead(
        cls, lead: Lead, customer: Customer, stage: Optional[LeadStage]
    ) -> Dict[str, Any]:
        name = customer.full_name if customer else ""
        notes = lead.notes or ""
        mentioned = extract_mentioned_credit(
            " ".join(p for p in (notes, lead.interested_in or "", name) if p)
        )
        created_at = lead.updated_at or lead.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        credit = int(customer.credit_score) if customer and customer.credit_score else 0
        content = " ".join(
            p
            for p in (
                name,
                notes,
                lead.interested_in or "",
                lead.interested_brand or "",
                f"credit score {credit}" if credit else "",
                stage.display_name if stage else "",
            )
            if p
        )
        return cls._base_lead_fields(lead, customer, stage) | {
            "id": f"lead_{lead.id}",
            "doc_type": "lead",
            "activity_id": "",
            "activity_type": "lead",
            "content": content,
            "description": notes,
            "customer_name": name,
            "mentioned_credit_score": mentioned or 0,
            "created_at": created_at.isoformat() if created_at else None,
            "keywords": " ".join(extract_keywords(content)),
        }

    @classmethod
    async def index_activity(cls, db: AsyncSession, activity_id: UUID) -> bool:
        if not cls.is_azure_configured():
            return False
        doc = await cls.build_document_for_activity(db, activity_id)
        if not doc:
            return False
        try:
            client = cls._azure_search_client()
            client.upload_documents([doc])
            return True
        except Exception:
            logger.exception("Azure index upload failed for activity %s", activity_id)
            return False

    @classmethod
    async def delete_activity_document(cls, activity_id: UUID) -> bool:
        if not cls.is_azure_configured():
            return False
        try:
            client = cls._azure_search_client()
            client.delete_documents([{"id": str(activity_id)}])
            return True
        except Exception:
            logger.exception("Azure delete failed for activity %s", activity_id)
            return False

    # ------------------------------------------------------------------ Search
    @classmethod
    async def search(
        cls,
        db: AsyncSession,
        user: User,
        *,
        query: str,
        days: Optional[int] = None,
        activity_types: Optional[List[str]] = None,
        pool: Optional[str] = None,
        dealership_id: Optional[UUID] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        credit_min: Optional[int] = None,
        credit_max: Optional[int] = None,
        exclude_stages: Optional[List[str]] = None,
        include_stages: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        q = (query or "").strip()
        if not q:
            return {
                "total": 0,
                "total_count": 0,
                "hits": [],
                "grouped_leads": [],
                "backend": "none",
                "filter_params": {},
                "offset": 0,
                "limit": 0,
                "has_more": False,
            }

        page_size = min(
            max(int(limit or settings.crm_search_page_size), 1),
            settings.crm_search_max_results,
        )
        page_offset = max(int(offset or 0), 0)
        accessible = await get_accessible_dealership_ids(db, user)

        if pool is None and user.role == UserRole.SALESPERSON:
            pool = "mine"

        filter_params: Dict[str, Any] = {"query": q}
        if pool:
            filter_params["pool"] = pool
        if days:
            filter_params["days"] = days
        if activity_types:
            filter_params["activity_types"] = activity_types
        if dealership_id:
            filter_params["dealership_id"] = str(dealership_id)
        if credit_min is not None:
            filter_params["credit_min"] = credit_min
        if credit_max is not None:
            filter_params["credit_max"] = credit_max
        if exclude_stages:
            filter_params["exclude_stages"] = exclude_stages
        if include_stages:
            filter_params["include_stages"] = include_stages

        if cls.is_azure_configured():
            try:
                hits, total_count = await cls._search_azure(
                    db,
                    user,
                    q,
                    accessible,
                    pool=pool,
                    days=days,
                    activity_types=activity_types,
                    dealership_id=dealership_id,
                    limit=page_size,
                    offset=page_offset,
                    credit_min=credit_min,
                    credit_max=credit_max,
                    exclude_stages=exclude_stages,
                    include_stages=include_stages,
                )
                grouped = cls._group_hits_by_lead(hits)
                has_more = (page_offset + len(hits)) < total_count
                return {
                    "total": len(hits),
                    "total_count": total_count,
                    "hits": hits,
                    "grouped_leads": grouped,
                    "backend": "azure",
                    "filter_params": filter_params,
                    "offset": page_offset,
                    "limit": page_size,
                    "has_more": has_more,
                }
            except Exception:
                logger.exception("Azure search failed; falling back to PostgreSQL")

        hits, total_count = await cls._search_postgres(
            db,
            user,
            q,
            accessible,
            pool=pool,
            days=days,
            activity_types=activity_types,
            dealership_id=dealership_id,
            limit=page_size,
            offset=page_offset,
        )
        grouped = cls._group_hits_by_lead(hits)
        has_more = (page_offset + len(hits)) < total_count
        return {
            "total": len(hits),
            "total_count": total_count,
            "hits": hits,
            "grouped_leads": grouped,
            "backend": "postgres",
            "filter_params": filter_params,
            "offset": page_offset,
            "limit": page_size,
            "has_more": has_more,
        }

    @classmethod
    def format_rag_context(
        cls,
        result: Dict[str, Any],
        max_snippets: Optional[int] = None,
    ) -> str:
        max_snippets = max_snippets or settings.crm_search_rag_snippets
        """Compact context block for the LLM (grounded answers only)."""
        hits = result.get("hits") or []
        if not hits:
            return ""

        lines = [
            "Relevant CRM timeline excerpts (cite these only; do not invent leads or quotes):",
        ]
        for hit in hits[:max_snippets]:
            lead_name = hit.get("lead_name") or "Unknown"
            lead_id = hit.get("lead_id") or ""
            snippet = hit.get("snippet") or ""
            atype = _activity_type_label(hit.get("activity_type") or "")
            created = hit.get("created_at") or ""
            lines.append(
                f"- Lead: {lead_name} (id={lead_id}) | {atype} | {created}\n  \"{snippet}\""
            )
        return "\n".join(lines)

    @staticmethod
    def _group_hits_by_lead(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        by_lead: Dict[str, Dict[str, Any]] = {}
        for hit in hits:
            lid = hit.get("lead_id")
            if not lid:
                continue
            if lid not in by_lead:
                by_lead[lid] = {
                    "lead_id": lid,
                    "lead_name": hit.get("lead_name"),
                    "stage": hit.get("stage"),
                    "phone": hit.get("phone"),
                    "snippets": [],
                }
            by_lead[lid]["snippets"].append(
                {
                    "activity_id": hit.get("activity_id"),
                    "activity_type": hit.get("activity_type"),
                    "activity_label": _activity_type_label(hit.get("activity_type") or ""),
                    "created_at": hit.get("created_at"),
                    "snippet": hit.get("snippet"),
                }
            )
        return list(by_lead.values())

    @classmethod
    async def _load_activity_context(
        cls, db: AsyncSession, activity_id: UUID
    ) -> Optional[tuple]:
        result = await db.execute(
            select(Activity, Lead, Customer, LeadStage)
            .join(Lead, Activity.lead_id == Lead.id)
            .join(Customer, Lead.customer_id == Customer.id)
            .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
            .where(Activity.id == activity_id)
        )
        return result.first()

    @classmethod
    async def _apply_lead_rbac(
        cls,
        db: AsyncSession,
        user: User,
        query,
        accessible: Optional[List[UUID]],
        *,
        pool: Optional[str],
        dealership_id: Optional[UUID],
    ):
        if pool == "mine":
            query = query.where(Lead.assigned_to == user.id)
        elif pool == "unassigned":
            query = query.where(Lead.assigned_to.is_(None))

        if pool != "mine":
            if accessible is None:
                pass
            elif not accessible:
                query = query.where(Lead.id.is_(None))
            else:
                query = query.where(
                    or_(Lead.dealership_id.in_(accessible), Lead.dealership_id.is_(None))
                )

        if dealership_id is not None:
            query = query.where(Lead.dealership_id == dealership_id)

        return query

    @classmethod
    async def _search_postgres(
        cls,
        db: AsyncSession,
        user: User,
        query_text: str,
        accessible: Optional[List[UUID]],
        *,
        pool: Optional[str],
        days: Optional[int],
        activity_types: Optional[List[str]],
        dealership_id: Optional[UUID],
        limit: int,
        offset: int = 0,
    ) -> tuple[List[Dict[str, Any]], int]:
        term = f"%{query_text}%"
        meta = Activity.meta_data

        q = (
            select(Activity, Lead, Customer, LeadStage)
            .join(Lead, Activity.lead_id == Lead.id)
            .join(Customer, Lead.customer_id == Customer.id)
            .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
            .where(Activity.lead_id.isnot(None))
            .where(Activity.type.in_(tuple(INDEXABLE_ACTIVITY_TYPES)))
        )

        q = await cls._apply_lead_rbac(
            db, user, q, accessible, pool=pool, dealership_id=dealership_id
        )

        if days and days > 0:
            since = datetime.now(timezone.utc) - timedelta(days=days)
            q = q.where(Activity.created_at >= since)

        parsed_types = _parse_activity_types(activity_types)
        if parsed_types:
            q = q.where(Activity.type.in_(parsed_types))

        text_filter = or_(
            Activity.description.ilike(term),
            meta["content"].astext.ilike(term),
            meta["body_preview"].astext.ilike(term),
            meta["body"].astext.ilike(term),
            meta["subject"].astext.ilike(term),
            meta["notes"].astext.ilike(term),
            meta["message"].astext.ilike(term),
            Customer.first_name.ilike(term),
            Customer.last_name.ilike(term),
            Lead.notes.ilike(term),
            Lead.interested_in.ilike(term),
            Lead.interested_brand.ilike(term),
        )
        count_q = select(func.count()).select_from(q.where(text_filter).subquery())
        total_count = (await db.execute(count_q)).scalar() or 0

        q = (
            q.where(text_filter)
            .order_by(Activity.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        rows = (await db.execute(q)).all()
        hits: List[Dict[str, Any]] = []
        for activity, lead, customer, stage in rows:
            snippet = extract_activity_content(activity)
            if len(snippet) > 280:
                snippet = snippet[:277] + "..."
            hits.append(
                cls._hit_dict(activity, lead, customer, stage, snippet)
            )
        return hits, total_count

    @classmethod
    async def _search_azure(
        cls,
        db: AsyncSession,
        user: User,
        query_text: str,
        accessible: Optional[List[UUID]],
        *,
        pool: Optional[str],
        days: Optional[int],
        activity_types: Optional[List[str]],
        dealership_id: Optional[UUID],
        limit: int,
        offset: int = 0,
        credit_min: Optional[int] = None,
        credit_max: Optional[int] = None,
        exclude_stages: Optional[List[str]] = None,
        include_stages: Optional[List[str]] = None,
    ) -> tuple[List[Dict[str, Any]], int]:
        odata = await cls._build_azure_filter(
            db, user, accessible, pool=pool, days=days,
            activity_types=activity_types, dealership_id=dealership_id,
            credit_min=credit_min, credit_max=credit_max,
            exclude_stages=exclude_stages, include_stages=include_stages,
        )

        client = cls._azure_search_client()
        search_text = query_text if query_text and query_text != "*" else "*"
        search_kwargs: Dict[str, Any] = {
            "search_text": search_text,
            "top": limit,
            "skip": offset,
            "include_total_count": True,
            "select": [
                "activity_id", "lead_id", "activity_type", "content", "description",
                "customer_name", "stage_name", "stage_display", "created_at",
                "credit_score", "mentioned_credit_score", "doc_type",
            ],
            "highlight_fields": "content,description,customer_name,lead_notes",
        }
        if odata:
            search_kwargs["filter"] = odata
        if cls._semantic_enabled and search_text != "*":
            search_kwargs["query_type"] = "semantic"
            search_kwargs["semantic_configuration_name"] = "crm-semantic"
            search_kwargs["query_caption"] = "extractive"

        try:
            results = client.search(**search_kwargs)
        except Exception:
            if search_kwargs.pop("query_type", None):
                search_kwargs.pop("semantic_configuration_name", None)
                search_kwargs.pop("query_caption", None)
                logger.warning("Semantic query failed; retrying simple Azure search")
                results = client.search(**search_kwargs)
            else:
                raise
        total_count = getattr(results, "get_count", lambda: None)()
        if total_count is None:
            total_count = offset + limit

        hits: List[Dict[str, Any]] = []
        lead_ids: Set[str] = set()

        for doc in results:
            lead_id = doc.get("lead_id")
            if lead_id:
                lead_ids.add(lead_id)

            snippet = doc.get("content") or doc.get("description") or ""
            highlights = doc.get("@search.highlights") or {}
            captions = doc.get("@search.captions") or []
            if captions and getattr(captions[0], "text", None):
                snippet = captions[0].text
            elif highlights.get("content"):
                snippet = highlights["content"][0]
            elif highlights.get("description"):
                snippet = highlights["description"][0]
            snippet = re.sub(r"<[^>]+>", "", snippet)
            if len(snippet) > 280:
                snippet = snippet[:277] + "..."

            created = doc.get("created_at")
            if isinstance(created, datetime):
                created_str = created.isoformat()
            else:
                created_str = str(created) if created else ""

            hits.append(
                {
                    "activity_id": doc.get("activity_id"),
                    "lead_id": lead_id,
                    "lead_name": doc.get("customer_name"),
                    "stage": doc.get("stage_name"),
                    "phone": None,
                    "activity_type": doc.get("activity_type"),
                    "created_at": created_str,
                    "snippet": snippet,
                }
            )

        if lead_ids and hits:
            phone_map = await cls._load_phones_for_leads(db, [UUID(x) for x in lead_ids])
            for hit in hits:
                lid = hit.get("lead_id")
                if lid and lid in phone_map:
                    hit["phone"] = phone_map[lid]

        return hits, int(total_count)

    @classmethod
    async def _build_azure_filter(
        cls,
        db: AsyncSession,
        user: User,
        accessible: Optional[List[UUID]],
        *,
        pool: Optional[str],
        days: Optional[int],
        activity_types: Optional[List[str]],
        dealership_id: Optional[UUID],
        credit_min: Optional[int] = None,
        credit_max: Optional[int] = None,
        exclude_stages: Optional[List[str]] = None,
        include_stages: Optional[List[str]] = None,
    ) -> Optional[str]:
        clauses: List[str] = []

        if pool == "mine":
            clauses.append(f"assigned_to eq '{user.id}'")
        elif pool == "unassigned":
            clauses.append("assigned_to eq ''")

        if pool != "mine":
            if accessible is not None:
                if not accessible:
                    return "lead_id eq '00000000-0000-0000-0000-000000000000'"
                parts = [f"dealership_id eq '{d}'" for d in accessible]
                parts.append("dealership_id eq ''")
                clauses.append(f"({' or '.join(parts)})")

        if dealership_id:
            clauses.append(f"dealership_id eq '{dealership_id}'")

        if days and days > 0:
            since = datetime.now(timezone.utc) - timedelta(days=days)
            clauses.append(f"created_at ge {since.isoformat()}")

        parsed_types = _parse_activity_types(activity_types)
        if parsed_types:
            type_clause = " or ".join(f"activity_type eq '{t.value}'" for t in parsed_types)
            clauses.append(f"({type_clause})")

        if credit_min is not None or credit_max is not None:
            credit_parts = []
            if credit_min is not None:
                credit_parts.append(
                    f"(credit_score ge {int(credit_min)} or mentioned_credit_score ge {int(credit_min)})"
                )
            if credit_max is not None:
                credit_parts.append(
                    f"((credit_score gt 0 and credit_score le {int(credit_max)}) "
                    f"or (mentioned_credit_score gt 0 and mentioned_credit_score le {int(credit_max)}))"
                )
            clauses.append("(" + " and ".join(credit_parts) + ")")

        if include_stages:
            inc = []
            for raw in include_stages:
                token = raw.replace("'", "")
                inc.append(f"stage_name eq '{token}'")
                inc.append(f"stage_display eq '{token}'")
            if inc:
                clauses.append(f"({' or '.join(inc)})")

        if exclude_stages:
            exc = []
            for raw in exclude_stages:
                token = raw.replace("'", "").lower()
                exc.append(f"stage_name eq '{token}'")
                exc.append(f"stage_display eq '{token}'")
                if token in ("sold", "converted"):
                    exc.append("outcome eq 'converted'")
                    exc.append("stage_name eq 'converted'")
                    exc.append("stage_name eq 'sold'")
            if exc:
                clauses.append(f"not ({' or '.join(dict.fromkeys(exc))})")

        if not clauses:
            return None
        return " and ".join(clauses)

    @staticmethod
    async def _load_phones_for_leads(
        db: AsyncSession, lead_ids: Sequence[UUID]
    ) -> Dict[str, Optional[str]]:
        if not lead_ids:
            return {}
        result = await db.execute(
            select(Lead.id, Customer.phone)
            .join(Customer, Lead.customer_id == Customer.id)
            .where(Lead.id.in_(list(lead_ids)))
        )
        return {str(row[0]): row[1] for row in result.all()}

    @staticmethod
    def _hit_dict(
        activity: Activity,
        lead: Lead,
        customer: Customer,
        stage: Optional[LeadStage],
        snippet: str,
    ) -> Dict[str, Any]:
        created = activity.created_at
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return {
            "activity_id": str(activity.id),
            "lead_id": str(lead.id),
            "lead_name": customer.full_name if customer else None,
            "stage": stage.name if stage else None,
            "phone": customer.phone if customer else None,
            "activity_type": activity.type.value,
            "created_at": created.isoformat() if created else None,
            "snippet": snippet,
        }

    @classmethod
    async def backfill_index(
        cls, db: AsyncSession, *, batch_size: int = 200, max_batches: int = 500
    ) -> Dict[str, int]:
        """Index leads and historical activities into Azure Search."""
        if not cls.is_azure_configured():
            return {"indexed": 0, "skipped": 0, "batches": 0, "leads": 0}

        await cls.ensure_index()
        indexed = 0
        skipped = 0
        batches = 0
        leads_indexed = 0

        lead_offset = 0
        while batches < max_batches:
            rows = (
                await db.execute(
                    select(Lead, Customer, LeadStage)
                    .join(Customer, Lead.customer_id == Customer.id)
                    .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
                    .order_by(Lead.updated_at.desc())
                    .offset(lead_offset)
                    .limit(batch_size)
                )
            ).all()
            if not rows:
                break
            docs = [cls.document_from_lead(lead, customer, stage) for lead, customer, stage in rows]
            try:
                results = cls._azure_search_client().upload_documents(docs)
                ok = sum(1 for r in results if getattr(r, "succeeded", False))
                leads_indexed += ok
                indexed += ok
                skipped += len(docs) - ok
            except Exception:
                logger.exception("Lead backfill failed at offset %s", lead_offset)
                skipped += len(docs)
            lead_offset += batch_size
            batches += 1
            if len(rows) < batch_size:
                break

        offset = 0
        while batches < max_batches:
            rows = (
                await db.execute(
                    select(Activity, Lead, Customer, LeadStage)
                    .join(Lead, Activity.lead_id == Lead.id)
                    .join(Customer, Lead.customer_id == Customer.id)
                    .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
                    .where(Activity.lead_id.isnot(None))
                    .order_by(Activity.created_at.desc())
                    .offset(offset)
                    .limit(batch_size)
                )
            ).all()
            if not rows:
                break

            docs: List[Dict[str, Any]] = []
            for activity, lead, customer, stage in rows:
                doc = cls.document_from_activity(activity, lead, customer, stage)
                if doc:
                    docs.append(doc)
                else:
                    skipped += 1

            if docs:
                try:
                    results = cls._azure_search_client().upload_documents(docs)
                    ok = sum(1 for r in results if getattr(r, "succeeded", False))
                    indexed += ok
                    skipped += len(docs) - ok
                except Exception:
                    logger.exception("Activity backfill failed at offset %s", offset)
                    skipped += len(docs)

            offset += batch_size
            batches += 1

        return {
            "indexed": indexed,
            "skipped": skipped,
            "batches": batches,
            "leads": leads_indexed,
        }
