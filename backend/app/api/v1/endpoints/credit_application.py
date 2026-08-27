"""
Lead credit application endpoints (in-CRM form).
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.database import get_db
from app.models.user import User
from app.schemas.credit_application import CreditApplicationResponse, CreditApplicationUpdate
from app.services.credit_application_service import credit_application_service
from app.services.stips_service import _lead_access

router = APIRouter()


@router.get("/{lead_id}/credit-application", response_model=CreditApplicationResponse)
async def get_credit_application(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Get or create draft credit application for a lead (with prefill on first access)."""
    lead = await _lead_access(db, lead_id, current_user)
    app = await credit_application_service.get_or_create(db, lead, current_user)
    await db.commit()
    await db.refresh(app)
    return await credit_application_service.to_response(db, app)


@router.put("/{lead_id}/credit-application", response_model=CreditApplicationResponse)
async def save_credit_application_draft(
    lead_id: UUID,
    body: CreditApplicationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Save credit application draft (all fields optional)."""
    lead = await _lead_access(db, lead_id, current_user)
    app = await credit_application_service.get_or_create(db, lead, current_user)
    await credit_application_service.save_draft(db, app, body, current_user)
    await db.commit()
    await db.refresh(app)
    return await credit_application_service.to_response(db, app)


@router.post("/{lead_id}/credit-application/submit", response_model=CreditApplicationResponse)
async def submit_credit_application(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Submit credit application and sync key fields to customer/guest."""
    lead = await _lead_access(db, lead_id, current_user)
    app = await credit_application_service.get_or_create(db, lead, current_user)
    if app.status == "submitted":
        raise HTTPException(status_code=400, detail="Application is already submitted.")
    await credit_application_service.submit(db, app, lead, current_user)
    await db.commit()
    await db.refresh(app)
    return await credit_application_service.to_response(db, app)
