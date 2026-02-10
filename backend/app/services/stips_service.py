"""
Stips Service — Categories CRUD and lead/customer document listing, upload, delete, view.
"""
import re
import uuid
from typing import Any, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead
from app.models.stips_category import StipsCategory
from app.models.customer_stip_document import CustomerStipDocument
from app.models.lead_stip_document import LeadStipDocument
from app.models.user import User
from app.services.azure_storage_service import azure_storage_service


# Max file size (15 MB). Any document type is allowed.
MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024


def _sanitize_filename(name: str) -> str:
    """Keep only safe characters for blob path."""
    safe = re.sub(r"[^\w\s\-\.]", "", name)
    return (safe or "file").strip()[:200]


class StipsCategoryService:
    """CRUD and reorder for Stips categories."""

    @staticmethod
    async def list_categories(
        db: AsyncSession,
        dealership_id: Optional[uuid.UUID] = None,
    ) -> List[StipsCategory]:
        """List categories (optionally filtered by dealership), ordered by display_order."""
        q = select(StipsCategory)
        if dealership_id is not None:
            q = q.where(StipsCategory.dealership_id == dealership_id)
        q = q.order_by(StipsCategory.display_order, StipsCategory.name)
        result = await db.execute(q)
        return list(result.scalars().all())

    @staticmethod
    async def get_category(db: AsyncSession, category_id: uuid.UUID) -> Optional[StipsCategory]:
        result = await db.execute(select(StipsCategory).where(StipsCategory.id == category_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def create_category(
        db: AsyncSession,
        name: str,
        display_order: int = 0,
        scope: str = "lead",
        dealership_id: Optional[uuid.UUID] = None,
    ) -> StipsCategory:
        cat = StipsCategory(
            name=name,
            display_order=display_order,
            scope=scope,
            dealership_id=dealership_id,
        )
        db.add(cat)
        await db.flush()
        return cat

    @staticmethod
    async def update_category(
        db: AsyncSession,
        category: StipsCategory,
        data: dict,
    ) -> StipsCategory:
        for k, v in data.items():
            if hasattr(category, k):
                setattr(category, k, v)
        await db.flush()
        return category

    @staticmethod
    async def delete_category(db: AsyncSession, category_id: uuid.UUID) -> Tuple[bool, str]:
        """Delete category only if no documents reference it. Returns (success, message)."""
        # Count customer docs
        r1 = await db.execute(
            select(CustomerStipDocument).where(CustomerStipDocument.stips_category_id == category_id)
        )
        if r1.scalars().first() is not None:
            return False, "Category has customer documents"
        # Count lead docs
        r2 = await db.execute(
            select(LeadStipDocument).where(LeadStipDocument.stips_category_id == category_id)
        )
        if r2.scalars().first() is not None:
            return False, "Category has lead documents"
        cat = await StipsCategoryService.get_category(db, category_id)
        if not cat:
            return False, "Category not found"
        await db.delete(cat)
        await db.flush()
        return True, "Deleted"

    @staticmethod
    async def reorder_categories(
        db: AsyncSession,
        ordered_ids: List[uuid.UUID],
    ) -> None:
        for idx, cid in enumerate(ordered_ids):
            result = await db.execute(select(StipsCategory).where(StipsCategory.id == cid))
            cat = result.scalar_one_or_none()
            if cat:
                cat.display_order = idx
        await db.flush()


async def _lead_access(
    db: AsyncSession,
    lead_id: uuid.UUID,
    current_user: User,
) -> Lead:
    """Load lead and check access; raise HTTPException if not found or no access."""
    from fastapi import HTTPException
    from app.core.permissions import UserRole

    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    is_unassigned = lead.dealership_id is None
    if not is_unassigned:
        has_access = (
            current_user.role == UserRole.SUPER_ADMIN
            or (
                current_user.role == UserRole.SALESPERSON
                and (
                    lead.assigned_to == current_user.id
                    or lead.dealership_id == current_user.dealership_id
                )
            )
            or (
                current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]
                and lead.dealership_id == current_user.dealership_id
            )
        )
        if not has_access:
            raise HTTPException(status_code=403, detail="Not authorized to access this lead")
    else:
        if current_user.role != UserRole.SUPER_ADMIN and not current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this lead")
    return lead


async def list_documents_for_lead(
    db: AsyncSession,
    lead_id: uuid.UUID,
    lead: Lead,
    category_id: Optional[uuid.UUID] = None,
) -> List[dict]:
    """
    List all stips documents visible on this lead.
    For customer-scoped categories: docs from customer_stip_documents for lead.customer_id (and secondary).
    For lead-scoped: docs from lead_stip_documents for lead_id.
    Returns list of StipDocumentResponse-like dicts.
    """
    # Get categories (we need name and scope)
    q_cat = select(StipsCategory).order_by(StipsCategory.display_order)
    if category_id is not None:
        q_cat = q_cat.where(StipsCategory.id == category_id)
    cats_result = await db.execute(q_cat)
    categories = list(cats_result.scalars().all())
    if not categories:
        return []

    out: List[dict] = []
    customer_ids = [lead.customer_id]
    if lead.secondary_customer_id:
        customer_ids.append(lead.secondary_customer_id)

    for cat in categories:
        if category_id is not None and cat.id != category_id:
            continue
        if cat.scope == "customer":
            q = (
                select(CustomerStipDocument, User)
                .join(User, CustomerStipDocument.uploaded_by == User.id, isouter=True)
                .where(
                    CustomerStipDocument.stips_category_id == cat.id,
                    CustomerStipDocument.customer_id.in_(customer_ids),
                )
            )
            res = await db.execute(q)
            for row in res.all():
                doc, user = row[0], row[1]
                customer_scope = "primary" if doc.customer_id == lead.customer_id else "secondary"
                out.append({
                    "id": doc.id,
                    "category_id": cat.id,
                    "category_name": cat.name,
                    "scope": "customer",
                    "file_name": doc.file_name,
                    "content_type": doc.content_type,
                    "file_size": doc.file_size,
                    "uploaded_at": doc.uploaded_at,
                    "uploaded_by_name": f"{user.first_name} {user.last_name}" if user else None,
                    "customer_scope": customer_scope,
                })
        else:
            q = (
                select(LeadStipDocument, User)
                .join(User, LeadStipDocument.uploaded_by == User.id, isouter=True)
                .where(
                    LeadStipDocument.stips_category_id == cat.id,
                    LeadStipDocument.lead_id == lead_id,
                )
            )
            res = await db.execute(q)
            for row in res.all():
                doc, user = row[0], row[1]
                out.append({
                    "id": doc.id,
                    "category_id": cat.id,
                    "category_name": cat.name,
                    "scope": "lead",
                    "file_name": doc.file_name,
                    "content_type": doc.content_type,
                    "file_size": doc.file_size,
                    "uploaded_at": doc.uploaded_at,
                    "uploaded_by_name": f"{user.first_name} {user.last_name}" if user else None,
                    "customer_scope": None,
                })
    return out


async def resolve_document_for_lead(
    db: AsyncSession,
    document_id: uuid.UUID,
    lead: Lead,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Resolve document by id: check if it belongs to this lead (via customer or lead).
    Returns (blob_path, "customer"|"lead") or (None, None) if not found / no access.
    """
    # Try lead_stip_documents
    r_lead = await db.execute(
        select(LeadStipDocument).where(
            LeadStipDocument.id == document_id,
            LeadStipDocument.lead_id == lead.id,
        )
    )
    doc_lead = r_lead.scalar_one_or_none()
    if doc_lead:
        return doc_lead.blob_path, "lead"
    # Try customer_stip_documents (primary or secondary customer)
    customer_ids = [lead.customer_id]
    if lead.secondary_customer_id:
        customer_ids.append(lead.secondary_customer_id)
    r_cust = await db.execute(
        select(CustomerStipDocument).where(
            CustomerStipDocument.id == document_id,
            CustomerStipDocument.customer_id.in_(customer_ids),
        )
    )
    doc_cust = r_cust.scalar_one_or_none()
    if doc_cust:
        return doc_cust.blob_path, "customer"
    return None, None


async def get_document_info_for_lead(
    db: AsyncSession,
    document_id: uuid.UUID,
    lead: Lead,
) -> Optional[Tuple[str, str]]:
    """
    Get (file_name, category_name) for a document that belongs to this lead.
    Returns None if document not found or not accessible.
    """
    # Try lead_stip_documents with category
    r_lead = await db.execute(
        select(LeadStipDocument, StipsCategory)
        .join(StipsCategory, LeadStipDocument.stips_category_id == StipsCategory.id)
        .where(
            LeadStipDocument.id == document_id,
            LeadStipDocument.lead_id == lead.id,
        )
    )
    row_lead = r_lead.first()
    if row_lead:
        return row_lead[0].file_name, row_lead[1].name
    # Try customer_stip_documents
    customer_ids = [lead.customer_id]
    if lead.secondary_customer_id:
        customer_ids.append(lead.secondary_customer_id)
    r_cust = await db.execute(
        select(CustomerStipDocument, StipsCategory)
        .join(StipsCategory, CustomerStipDocument.stips_category_id == StipsCategory.id)
        .where(
            CustomerStipDocument.id == document_id,
            CustomerStipDocument.customer_id.in_(customer_ids),
        )
    )
    row_cust = r_cust.first()
    if row_cust:
        return row_cust[0].file_name, row_cust[1].name
    return None


async def upload_document_for_lead(
    db: AsyncSession,
    lead: Lead,
    category_id: uuid.UUID,
    file_name: str,
    data: bytes,
    content_type: str,
    uploaded_by: uuid.UUID,
) -> dict:
    """
    Upload a file to the correct table (customer or lead) and Azure. Returns StipDocumentResponse-like dict.
    """
    category = await StipsCategoryService.get_category(db, category_id)
    if not category:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Category not found")
    if len(data) > MAX_FILE_SIZE_BYTES:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="File too large (max 15 MB)")

    safe_name = _sanitize_filename(file_name)
    unique = uuid.uuid4().hex[:12]
    blob_path: str
    file_size = len(data)

    if category.scope == "customer":
        if not lead.customer_id:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Lead has no customer")
        blob_path = f"customers/{lead.customer_id}/{category_id}/{unique}_{safe_name}"
        await azure_storage_service.upload_stip_document(blob_path, data, content_type)
        doc = CustomerStipDocument(
            customer_id=lead.customer_id,
            stips_category_id=category_id,
            file_name=file_name,
            blob_path=blob_path,
            content_type=content_type,
            file_size=file_size,
            uploaded_by=uploaded_by,
        )
        db.add(doc)
        await db.flush()
        # Load uploader name
        r = await db.execute(select(User).where(User.id == uploaded_by))
        user = r.scalar_one_or_none()
        uploaded_by_name = f"{user.first_name} {user.last_name}" if user else None
        return {
            "id": doc.id,
            "category_id": category.id,
            "category_name": category.name,
            "scope": "customer",
            "file_name": doc.file_name,
            "content_type": doc.content_type,
            "file_size": doc.file_size,
            "uploaded_at": doc.uploaded_at,
            "uploaded_by_name": uploaded_by_name,
            "customer_scope": "primary",
        }
    else:
        blob_path = f"leads/{lead.id}/{category_id}/{unique}_{safe_name}"
        await azure_storage_service.upload_stip_document(blob_path, data, content_type)
        doc = LeadStipDocument(
            lead_id=lead.id,
            stips_category_id=category_id,
            file_name=file_name,
            blob_path=blob_path,
            content_type=content_type,
            file_size=file_size,
            uploaded_by=uploaded_by,
        )
        db.add(doc)
        await db.flush()
        r = await db.execute(select(User).where(User.id == uploaded_by))
        user = r.scalar_one_or_none()
        uploaded_by_name = f"{user.first_name} {user.last_name}" if user else None
        return {
            "id": doc.id,
            "category_id": category.id,
            "category_name": category.name,
            "scope": "lead",
            "file_name": doc.file_name,
            "content_type": doc.content_type,
            "file_size": doc.file_size,
            "uploaded_at": doc.uploaded_at,
            "uploaded_by_name": uploaded_by_name,
            "customer_scope": None,
        }


async def delete_document_for_lead(
    db: AsyncSession,
    document_id: uuid.UUID,
    lead: Lead,
) -> bool:
    """Delete document (from either table) and blob. Returns True if deleted."""
    blob_path, scope = await resolve_document_for_lead(db, document_id, lead)
    if not blob_path:
        return False
    await azure_storage_service.delete_stip_document(blob_path)
    if scope == "lead":
        r = await db.execute(select(LeadStipDocument).where(LeadStipDocument.id == document_id))
        doc = r.scalar_one_or_none()
        if doc:
            await db.delete(doc)
    else:
        r = await db.execute(select(CustomerStipDocument).where(CustomerStipDocument.id == document_id))
        doc = r.scalar_one_or_none()
        if doc:
            await db.delete(doc)
    await db.flush()
    return True
