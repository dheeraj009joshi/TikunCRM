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
    """Response for manual sync trigger."""
    success: bool
    message: str
    new_leads_added: int = 0


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
    current_user: User = Depends(get_current_user),
):
    """
    Manually trigger a Google Sheets sync.
    This runs the sync immediately instead of waiting for the scheduler.
    """
    # Only super admins can trigger sync
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only Super Admins can trigger sync"
        )
    
    try:
        from app.services.google_sheets_sync import sync_google_sheet_leads
        await sync_google_sheet_leads()
        
        return SyncTriggerResponse(
            success=True,
            message="Google Sheets sync completed successfully. Check the leads page for new entries."
        )
    except Exception as e:
        return SyncTriggerResponse(
            success=False,
            message=f"Sync failed: {str(e)}"
        )
