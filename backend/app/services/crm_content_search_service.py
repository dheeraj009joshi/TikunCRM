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
        """Create or update the Azure Search index schema."""
        if not cls.is_azure_configured():
            return False
        try:
            from azure.search.documents.indexes.models import (
                SearchableField,
                SearchField,
                SearchFieldDataType,
                SearchIndex,
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
                SearchableField(
                    name="keywords",
                    type=SearchFieldDataType.Collection(SearchFieldDataType.String),
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
                SearchField(
                    name="created_at",
                    type=SearchFieldDataType.DateTimeOffset,
                    filterable=True,
                    sortable=True,
                ),
            ]
            index = SearchIndex(name=settings.azure_search_index, fields=fields)
            client = cls._azure_index_client()
            client.create_or_update_index(index)
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
        activity, lead, customer, stage = row
        if not is_indexable_activity(activity.type) or not activity.lead_id:
            return None

        content = extract_activity_content(activity)
        if not content.strip():
            return None

        customer_name = customer.full_name if customer else ""
        created_at = activity.created_at
        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        doc = {
            "id": str(activity.id),
            "activity_id": str(activity.id),
            "lead_id": str(lead.id),
            "activity_type": activity.type.value,
            "content": content,
            "description": activity.description or "",
            "customer_name": customer_name,
            "interested_in": lead.interested_in or "",
            "interested_brand": lead.interested_brand or "",
            "lead_notes": lead.notes or "",
            "dealership_id": str(lead.dealership_id) if lead.dealership_id else "",
            "assigned_to": str(lead.assigned_to) if lead.assigned_to else "",
            "stage_name": stage.name if stage else "",
            "created_at": created_at.isoformat() if created_at else None,
            "keywords": extract_keywords(content),
        }
        return doc

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
    ) -> tuple[List[Dict[str, Any]], int]:
        odata = await cls._build_azure_filter(
            db, user, accessible, pool=pool, days=days,
            activity_types=activity_types, dealership_id=dealership_id,
        )

        client = cls._azure_search_client()
        search_kwargs: Dict[str, Any] = {
            "search_text": query_text,
            "top": limit,
            "skip": offset,
            "include_total_count": True,
            "select": [
                "activity_id", "lead_id", "activity_type", "content", "description",
                "customer_name", "stage_name", "created_at",
            ],
            "highlight_fields": "content,description,customer_name,lead_notes",
        }
        if odata:
            search_kwargs["filter"] = odata

        results = client.search(**search_kwargs)
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
            if highlights.get("content"):
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
        """Index historical activities into Azure Search."""
        if not cls.is_azure_configured():
            return {"indexed": 0, "skipped": 0, "batches": 0}

        await cls.ensure_index()
        indexed = 0
        skipped = 0
        batches = 0
        offset = 0

        while batches < max_batches:
            result = await db.execute(
                select(Activity.id)
                .where(Activity.lead_id.isnot(None))
                .where(Activity.type.in_(tuple(INDEXABLE_ACTIVITY_TYPES)))
                .order_by(Activity.created_at.desc())
                .offset(offset)
                .limit(batch_size)
            )
            ids = [row[0] for row in result.all()]
            if not ids:
                break

            docs: List[Dict[str, Any]] = []
            for aid in ids:
                doc = await cls.build_document_for_activity(db, aid)
                if doc:
                    docs.append(doc)
                else:
                    skipped += 1

            if docs:
                try:
                    client = cls._azure_search_client()
                    client.upload_documents(docs)
                    indexed += len(docs)
                except Exception:
                    logger.exception("Backfill batch upload failed at offset %s", offset)

            offset += batch_size
            batches += 1

        return {"indexed": indexed, "skipped": skipped, "batches": batches}
