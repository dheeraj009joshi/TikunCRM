"""
SMS API Endpoints - Conversation-style messaging
"""
import logging
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.config import settings
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.sms_log import SMSLog, MessageDirection
from app.models.lead import Lead
from app.services.sms_conversation_service import SMSConversationService, get_sms_conversation_service
from app.core.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Schemas ============

class SMSConfigResponse(BaseModel):
    """SMS configuration status"""
    sms_enabled: bool
    phone_number: Optional[str]


class SendSMSRequest(BaseModel):
    """Request to send SMS"""
    to_number: str = Field(..., description="Phone number to send to")
    body: str = Field(..., min_length=1, max_length=1600, description="Message body")
    lead_id: Optional[UUID] = Field(None, description="Optional lead ID")


class SendSMSResponse(BaseModel):
    """Response for SMS send"""
    success: bool
    message_id: Optional[UUID] = None
    error: Optional[str] = None


class SMSMessageResponse(BaseModel):
    """Single SMS message"""
    id: UUID
    lead_id: Optional[UUID]
    user_id: Optional[UUID]
    direction: str
    from_number: str
    to_number: str
    body: str
    status: str
    is_read: bool
    created_at: datetime
    sent_at: Optional[datetime]
    delivered_at: Optional[datetime]
    
    class Config:
        from_attributes = True


class ConversationResponse(BaseModel):
    """SMS conversation with lead"""
    lead_id: UUID
    lead_name: str
    lead_phone: Optional[str]
    messages: List[SMSMessageResponse]


class ConversationListItem(BaseModel):
    """Conversation list item"""
    lead_id: str
    lead_name: str
    lead_phone: Optional[str]
    last_message: dict
    unread_count: int


class ConversationsListResponse(BaseModel):
    """List of conversations"""
    items: List[ConversationListItem]
    total_unread: int


class UnreadCountResponse(BaseModel):
    """Unread message count"""
    count: int


# ============ Endpoints ============

@router.get("/config", response_model=SMSConfigResponse)
async def get_sms_config(
    current_user: User = Depends(deps.get_current_active_user)
):
    """Get SMS configuration status"""
    return SMSConfigResponse(
        sms_enabled=settings.is_twilio_configured,
        phone_number=settings.twilio_phone_number if settings.is_twilio_configured else None
    )


@router.post("/send", response_model=SendSMSResponse)
async def send_sms(
    request: SendSMSRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Send an SMS message"""
    if not settings.is_twilio_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMS is not configured"
        )
    
    service = get_sms_conversation_service(db)
    
    success, sms_log, error = await service.send_sms(
        to_number=request.to_number,
        body=request.body,
        user_id=current_user.id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id
    )
    
    await db.commit()
    
    if success and sms_log:
        # Send real-time update
        if sms_log.lead_id:
            await ws_manager.broadcast_to_dealership(
                str(sms_log.dealership_id) if sms_log.dealership_id else None,
                {
                    "type": "sms:sent",
                    "payload": {
                        "message_id": str(sms_log.id),
                        "lead_id": str(sms_log.lead_id),
                        "body_preview": sms_log.body[:50] if sms_log.body else ""
                    }
                }
            )
        
        return SendSMSResponse(
            success=True,
            message_id=sms_log.id
        )
    
    return SendSMSResponse(
        success=False,
        error=error
    )


@router.get("/conversations", response_model=ConversationsListResponse)
async def list_conversations(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """List SMS conversations"""
    service = get_sms_conversation_service(db)
    
    # Apply role-based filtering
    user_id = None
    dealership_id = None
    
    if current_user.role == UserRole.SALESPERSON:
        user_id = current_user.id
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        dealership_id = current_user.dealership_id
    # Super admin sees all
    
    conversations = await service.get_conversations_list(
        user_id=user_id,
        dealership_id=dealership_id,
        unread_only=unread_only,
        limit=limit,
        offset=offset
    )
    
    total_unread = await service.get_unread_count(
        user_id=user_id,
        dealership_id=dealership_id
    )
    
    return ConversationsListResponse(
        items=[ConversationListItem(**c) for c in conversations],
        total_unread=total_unread
    )


@router.get("/conversations/{lead_id}", response_model=ConversationResponse)
async def get_conversation(
    lead_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[datetime] = None,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Get SMS conversation with a lead (returns full customer-level history)."""
    # Verify access to lead and load customer for name/phone
    result = await db.execute(
        select(Lead).options(selectinload(Lead.customer)).where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found"
        )
    
    # Check access
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if current_user.dealership_id and lead.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    service = get_sms_conversation_service(db)
    
    messages = await service.get_conversation(
        lead_id=lead_id,
        limit=limit,
        before=before
    )
    
    # Mark as read
    await service.mark_conversation_as_read(lead_id)
    await db.commit()
    
    return ConversationResponse(
        lead_id=lead.id,
        lead_name=f"{lead.first_name} {lead.last_name or ''}".strip(),
        lead_phone=lead.phone,
        messages=[
            SMSMessageResponse(
                id=msg.id,
                lead_id=msg.lead_id,
                user_id=msg.user_id,
                direction=msg.direction.value,
                from_number=msg.from_number,
                to_number=msg.to_number,
                body=msg.body,
                status=msg.status.value,
                is_read=msg.is_read,
                created_at=msg.created_at,
                sent_at=msg.sent_at,
                delivered_at=msg.delivered_at
            )
            for msg in messages
        ]
    )


@router.post("/conversations/{lead_id}/send", response_model=SendSMSResponse)
async def send_to_lead(
    lead_id: UUID,
    request: SendSMSRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Send SMS to a specific lead"""
    # Verify access to lead
    result = await db.execute(
        select(Lead).where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found"
        )
    
    if not lead.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lead has no phone number"
        )
    
    # Check access
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    service = get_sms_conversation_service(db)
    
    success, sms_log, error = await service.send_sms(
        to_number=lead.phone,
        body=request.body,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id
    )
    
    await db.commit()
    
    if success and sms_log:
        # Send real-time update
        await ws_manager.broadcast_to_dealership(
            str(lead.dealership_id) if lead.dealership_id else None,
            {
                "type": "sms:sent",
                "payload": {
                    "message_id": str(sms_log.id),
                    "lead_id": str(lead.id),
                    "body_preview": sms_log.body[:50] if sms_log.body else ""
                }
            }
        )
        
        return SendSMSResponse(
            success=True,
            message_id=sms_log.id
        )
    
    return SendSMSResponse(
        success=False,
        error=error
    )


@router.patch("/messages/{message_id}/read")
async def mark_message_read(
    message_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Mark a message as read"""
    service = get_sms_conversation_service(db)
    
    sms_log = await service.mark_as_read(message_id)
    
    if not sms_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
    
    await db.commit()
    
    return {"status": "ok"}


@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Get unread SMS count for current user"""
    service = get_sms_conversation_service(db)
    
    user_id = None
    dealership_id = None
    
    if current_user.role == UserRole.SALESPERSON:
        user_id = current_user.id
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        dealership_id = current_user.dealership_id
    
    count = await service.get_unread_count(
        user_id=user_id,
        dealership_id=dealership_id
    )
    
    return UnreadCountResponse(count=count)
