"""
Google Sheets sync endpoints for manual triggering and status.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.models.lead import Lead, LeadSource
from app.core.permissions import UserRole

router = APIRouter()


class SyncStatusResponse(BaseModel):
    """Response for sync status."""
    total_google_sheet_leads: int
    last_lead_synced_at: Optional[datetime]
    message: str


class SyncTriggerResponse(BaseModel):
    """Response for manual sync trigger with sheet vs system comparison."""
    success: bool
    message: str
    new_leads_added: int = 0
    leads_updated: int = 0
    leads_in_sheet: int = 0
    leads_in_system: int = 0
    sheet_total_rows: int = 0
    duplicates_skipped: int = 0
    skipped_invalid: int = 0
    error: Optional[str] = None


@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the current status of Google Sheets lead sync.
    Shows total leads synced from Google Sheets.
    """
    # Only super admins can view sync status
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only Super Admins can view sync status"
        )
    
    # Count leads from Google Sheets
    result = await db.execute(
        select(func.count(Lead.id)).where(Lead.source == LeadSource.GOOGLE_SHEETS)
    )
    total_leads = result.scalar() or 0
    
    # Get the most recent lead from Google Sheets
    result = await db.execute(
        select(Lead.created_at)
        .where(Lead.source == LeadSource.GOOGLE_SHEETS)
        .order_by(Lead.created_at.desc())
        .limit(1)
    )
    last_synced = result.scalar_one_or_none()
    
    return SyncStatusResponse(
        total_google_sheet_leads=total_leads,
        last_lead_synced_at=last_synced,
        message=f"Syncing leads from Google Sheet every 1 minute. {total_leads} leads imported so far."
    )


@router.post("/sync", response_model=SyncTriggerResponse)
async def trigger_sync(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Manually trigger a Google Sheets sync.
    Returns leads_in_sheet vs leads_in_system so you can compare counts.
    """
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only Super Admins can trigger sync"
        )

    try:
        from app.services.google_sheets_sync import sync_google_sheet_leads
        result = await sync_google_sheet_leads()
    except Exception as e:
        result = {
            "sheet_total_rows": 0,
            "sheet_valid_leads": 0,
            "new_added": 0,
            "leads_updated": 0,
            "duplicates_skipped": 0,
            "skipped_invalid": 0,
            "error": str(e),
        }

    r = await db.execute(
        select(func.count(Lead.id)).where(Lead.source == LeadSource.GOOGLE_SHEETS)
    )
    leads_in_system = r.scalar() or 0

    err = result.get("error")
    success = err is None
    return SyncTriggerResponse(
        success=success,
        message="Sync completed. Compare leads_in_sheet vs leads_in_system below."
            if success else f"Sync failed: {err}",
        new_leads_added=result.get("new_added", 0),
        leads_updated=result.get("leads_updated", 0),
        leads_in_sheet=result.get("sheet_valid_leads", 0),
        leads_in_system=leads_in_system,
        sheet_total_rows=result.get("sheet_total_rows", 0),
        duplicates_skipped=result.get("duplicates_skipped", 0),
        skipped_invalid=result.get("skipped_invalid", 0),
        error=err,
    )
