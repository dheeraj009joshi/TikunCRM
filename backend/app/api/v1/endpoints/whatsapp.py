"""
WhatsApp API Endpoints - Conversation-style messaging (WhatsApp-like)
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.config import settings
from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.whatsapp_log import WhatsAppLog, WhatsAppDirection
from app.models.whatsapp_template import WhatsAppTemplate
from app.services.whatsapp_conversation_service import get_whatsapp_conversation_service
from app.core.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


class WhatsAppConfigResponse(BaseModel):
    whatsapp_enabled: bool
    phone_number: Optional[str] = None


class SendWhatsAppRequest(BaseModel):
    to_number: str = Field(..., description="Phone number")
    body: Optional[str] = Field(None, min_length=1, max_length=4096, description="Message body (session message)")
    lead_id: Optional[UUID] = None
    content_sid: Optional[str] = Field(None, description="Template Content SID (e.g. HX...) for template message")
    content_variables: Optional[Dict[str, str]] = Field(None, description="Template variables e.g. {\"1\": \"value1\"}")

    @model_validator(mode="after")
    def body_or_content_sid(self):
        if self.body and self.content_sid:
            raise ValueError("Send either body (session message) or content_sid (template), not both")
        if not self.body and not self.content_sid:
            raise ValueError("Send either body or content_sid")
        if self.content_sid and not self.content_variables:
            self.content_variables = {}
        return self


class SendWhatsAppResponse(BaseModel):
    success: bool
    message_id: Optional[UUID] = None
    error: Optional[str] = None
    error_code: Optional[str] = None


class WhatsAppMessageResponse(BaseModel):
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


class WhatsAppMessageDetailResponse(WhatsAppMessageResponse):
    """Message details including Twilio SID for looking up in Twilio Console."""
    twilio_message_sid: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class WhatsAppConversationResponse(BaseModel):
    lead_id: UUID
    lead_name: str
    lead_phone: Optional[str]
    messages: List[WhatsAppMessageResponse]


class WhatsAppConversationListItem(BaseModel):
    lead_id: str
    lead_name: str
    lead_phone: Optional[str]
    last_message: dict
    unread_count: int


class WhatsAppConversationsListResponse(BaseModel):
    items: List[WhatsAppConversationListItem]
    total_unread: int


class WhatsAppUnreadCountResponse(BaseModel):
    count: int


class WhatsAppLeadSearchItem(BaseModel):
    lead_id: str
    lead_name: str
    lead_phone: Optional[str]


class SessionWindowResponse(BaseModel):
    within_window: bool
    last_inbound_at: Optional[datetime] = None


class WhatsAppTemplateItem(BaseModel):
    id: UUID
    content_sid: str
    name: str
    variable_names: List[str]


class WhatsAppTemplatesListResponse(BaseModel):
    items: List[WhatsAppTemplateItem]


@router.get("/leads/search", response_model=List[WhatsAppLeadSearchItem])
async def search_leads_for_whatsapp(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Search leads (by customer name or phone) for starting a new WhatsApp chat. Dealership-scoped."""
    if not current_user.dealership_id:
        return []
    search_term = f"%{q.strip()}%"
    query = (
        select(Lead)
        .options(selectinload(Lead.customer))
        .join(Customer, Lead.customer_id == Customer.id)
        .where(
            and_(
                Lead.dealership_id == current_user.dealership_id,
                Customer.phone.isnot(None),
                Customer.phone != "",
                or_(
                    Customer.first_name.ilike(search_term),
                    Customer.last_name.ilike(search_term),
                    Customer.phone.ilike(search_term),
                ),
            )
        )
        .limit(limit)
    )
    result = await db.execute(query)
    leads = result.scalars().all()
    return [
        WhatsAppLeadSearchItem(
            lead_id=str(lead.id),
            lead_name=f"{(lead.customer.first_name if lead.customer else '')} {(lead.customer.last_name or '')}".strip(),
            lead_phone=lead.customer.phone if lead.customer else None,
        )
        for lead in leads
    ]


@router.get("/config", response_model=WhatsAppConfigResponse)
async def get_whatsapp_config(
    current_user: User = Depends(deps.get_current_active_user)
):
    return WhatsAppConfigResponse(
        whatsapp_enabled=settings.is_whatsapp_configured,
        phone_number=settings.twilio_whatsapp_number if settings.is_whatsapp_configured else None
    )


@router.get("/templates", response_model=WhatsAppTemplatesListResponse)
async def list_whatsapp_templates(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """List WhatsApp Content templates (global + current user's dealership) for template picker."""
    q = select(WhatsAppTemplate).where(
        or_(
            WhatsAppTemplate.dealership_id.is_(None),
            WhatsAppTemplate.dealership_id == current_user.dealership_id,
        )
    )
    result = await db.execute(q)
    templates = result.scalars().all()
    return WhatsAppTemplatesListResponse(
        items=[
            WhatsAppTemplateItem(
                id=t.id,
                content_sid=t.content_sid,
                name=t.name,
                variable_names=t.variable_names or [],
            )
            for t in templates
        ]
    )


@router.post("/send", response_model=SendWhatsAppResponse)
async def send_whatsapp(
    request: SendWhatsAppRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    if not settings.is_whatsapp_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp is not configured"
        )
    service = get_whatsapp_conversation_service(db)
    if request.content_sid:
        success, wa_log, error = await service.send_whatsapp_template(
            to_number=request.to_number,
            content_sid=request.content_sid,
            content_variables=request.content_variables or {},
            user_id=current_user.id,
            lead_id=request.lead_id,
            dealership_id=current_user.dealership_id,
        )
    else:
        success, wa_log, error = await service.send_whatsapp(
            to_number=request.to_number,
            body=request.body or "",
            user_id=current_user.id,
            lead_id=request.lead_id,
            dealership_id=current_user.dealership_id,
        )
    await db.commit()
    if success and wa_log:
        if wa_log.lead_id:
            await ws_manager.broadcast_to_dealership(
                str(wa_log.dealership_id) if wa_log.dealership_id else None,
                {
                    "type": "whatsapp:sent",
                    "payload": {
                        "message_id": str(wa_log.id),
                        "lead_id": str(wa_log.lead_id),
                        "body_preview": wa_log.body[:50] if wa_log.body else ""
                    }
                }
            )
        return SendWhatsAppResponse(success=True, message_id=wa_log.id)
    return SendWhatsAppResponse(
        success=False,
        error=error,
        error_code=wa_log.error_code if wa_log else None,
    )


@router.get("/conversations", response_model=WhatsAppConversationsListResponse)
async def list_whatsapp_conversations(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    service = get_whatsapp_conversation_service(db)
    user_id = None
    dealership_id = None
    if current_user.role == UserRole.SALESPERSON:
        user_id = current_user.id
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        dealership_id = current_user.dealership_id
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
    return WhatsAppConversationsListResponse(
        items=[WhatsAppConversationListItem(**c) for c in conversations],
        total_unread=total_unread
    )


@router.get("/conversations/{lead_id}", response_model=WhatsAppConversationResponse)
async def get_whatsapp_conversation(
    lead_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[datetime] = None,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Lead).options(selectinload(Lead.customer)).where(Lead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if current_user.dealership_id and lead.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    service = get_whatsapp_conversation_service(db)
    messages = await service.get_conversation(lead_id=lead_id, limit=limit, before=before)
    await service.mark_conversation_as_read(lead_id)
    await db.commit()
    return WhatsAppConversationResponse(
        lead_id=lead.id,
        lead_name=f"{lead.first_name} {lead.last_name or ''}".strip(),
        lead_phone=lead.phone,
        messages=[
            WhatsAppMessageResponse(
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


@router.get("/conversations/{lead_id}/session-window", response_model=SessionWindowResponse)
async def get_whatsapp_session_window(
    lead_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Return whether the lead is within the 24-hour WhatsApp session window (last inbound message)."""
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if current_user.dealership_id and lead.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    service = get_whatsapp_conversation_service(db)
    last_inbound_at = await service.get_last_inbound_at(lead_id)
    now = utc_now()
    within_window = (
        last_inbound_at is not None
        and (now - last_inbound_at) <= timedelta(hours=24)
    )
    return SessionWindowResponse(within_window=within_window, last_inbound_at=last_inbound_at)


@router.post("/conversations/{lead_id}/send", response_model=SendWhatsAppResponse)
async def send_whatsapp_to_lead(
    lead_id: UUID,
    request: SendWhatsAppRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if not lead.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lead has no phone number"
        )
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    service = get_whatsapp_conversation_service(db)
    if request.content_sid:
        success, wa_log, error = await service.send_whatsapp_template(
            to_number=lead.phone,
            content_sid=request.content_sid,
            content_variables=request.content_variables or {},
            user_id=current_user.id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
        )
    else:
        success, wa_log, error = await service.send_whatsapp(
            to_number=lead.phone,
            body=request.body or "",
            user_id=current_user.id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
        )
    await db.commit()
    if success and wa_log:
        if lead.dealership_id:
            await ws_manager.broadcast_to_dealership(
                str(lead.dealership_id),
                {
                    "type": "whatsapp:sent",
                    "payload": {
                        "message_id": str(wa_log.id),
                        "lead_id": str(lead.id),
                        "body_preview": wa_log.body[:50] if wa_log.body else ""
                    }
                }
            )
        return SendWhatsAppResponse(success=True, message_id=wa_log.id)
    return SendWhatsAppResponse(
        success=False,
        error=error,
        error_code=wa_log.error_code if wa_log else None,
    )


@router.get("/messages/{message_id}", response_model=WhatsAppMessageDetailResponse)
async def get_whatsapp_message(
    message_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Get a single WhatsApp message by ID. Includes twilio_message_sid for looking up in Twilio Console."""
    result = await db.execute(
        select(WhatsAppLog).where(WhatsAppLog.id == message_id)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if current_user.role == UserRole.SALESPERSON and msg.lead_id:
        lead = (await db.execute(select(Lead).where(Lead.id == msg.lead_id))).scalar_one_or_none()
        if lead and lead.assigned_to != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return WhatsAppMessageDetailResponse(
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
        delivered_at=msg.delivered_at,
        twilio_message_sid=msg.twilio_message_sid if not str(msg.twilio_message_sid or "").startswith("pending_") else None,
        error_code=msg.error_code,
        error_message=msg.error_message,
    )


@router.patch("/messages/{message_id}/read")
async def mark_whatsapp_message_read(
    message_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    service = get_whatsapp_conversation_service(db)
    wa = await service.mark_as_read(message_id)
    if not wa:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    await db.commit()
    return {"status": "ok"}


@router.get("/unread-count", response_model=WhatsAppUnreadCountResponse)
async def get_whatsapp_unread_count(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    service = get_whatsapp_conversation_service(db)
    user_id = None
    dealership_id = None
    if current_user.role == UserRole.SALESPERSON:
        user_id = current_user.id
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        dealership_id = current_user.dealership_id
    count = await service.get_unread_count(user_id=user_id, dealership_id=dealership_id)
    return WhatsAppUnreadCountResponse(count=count)
