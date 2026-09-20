"""
CRM content search API — notes, calls, SMS, WhatsApp across leads.
"""
import logging
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.services.crm_content_search_service import CrmContentSearchService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/status")
async def crm_search_status(
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    return {
        "azure_configured": CrmContentSearchService.is_azure_configured(),
        "index": settings.azure_search_index if settings.is_azure_search_configured else None,
        "auto_retrieve_in_ai": settings.crm_search_auto_retrieve,
        "page_size": settings.crm_search_page_size,
        "max_results": settings.crm_search_max_results,
    }


@router.get("/")
async def search_crm_content(
    q: str = Query(..., min_length=1, description="Search notes, calls, messages"),
    days: Optional[int] = Query(None, ge=1, le=365),
    activity_types: Optional[List[str]] = Query(None),
    pool: Optional[str] = Query(None, pattern="^(mine|unassigned)$"),
    dealership_id: Optional[UUID] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Search timeline content the current user is allowed to see."""
    effective_limit = limit or settings.crm_search_page_size
    effective_limit = min(effective_limit, settings.crm_search_max_results)
    result = await CrmContentSearchService.search(
        db,
        current_user,
        query=q,
        days=days,
        activity_types=activity_types,
        pool=pool,
        dealership_id=dealership_id,
        limit=effective_limit,
        offset=offset,
    )
    return result


@router.post("/backfill")
async def backfill_crm_search_index(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Index historical activities into Azure AI Search (super admin only)."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin only")
    if not CrmContentSearchService.is_azure_configured():
        raise HTTPException(status_code=400, detail="Azure AI Search is not configured")

    await CrmContentSearchService.ensure_index()
    stats = await CrmContentSearchService.backfill_index(db)
    await db.commit()
    return {"message": "Backfill complete", **stats}
