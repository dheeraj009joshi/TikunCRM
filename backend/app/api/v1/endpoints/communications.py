"""
Communication Endpoints
"""
from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.models.user import User
from app.db.database import get_db
from app.services.email import EmailService
from app.schemas.activity import ActivityResponse # Reuse for simplicity

router = APIRouter()


@router.get("/lead/{lead_id}/emails", response_model=List[Any])
async def get_lead_emails(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get email history for a lead.
    """
    return await EmailService.get_lead_emails(db, lead_id)


@router.post("/send", status_code=status.HTTP_201_CREATED)
async def send_email(
    lead_id: UUID,
    subject: str,
    body: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Draft/Log an email sent to a lead.
    In a full implementation, this would trigger the actual Gmail API send.
    """
    email = await EmailService.log_email(
        db,
        lead_id=lead_id,
        user_id=current_user.id,
        subject=subject,
        body=body,
        direction="sent"
    )
    return email
