"""
WhatsApp API Endpoints - Conversation-style messaging (WhatsApp-like)
"""
import logging
from datetime import datetime
from typing import Optional, List, Dict
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.whatsapp_log import WhatsAppLog, WhatsAppDirection, WhatsAppStatus
from app.models.whatsapp_template import WhatsAppTemplate
from app.models.whatsapp_message import WhatsAppBulkSend
from app.models.campaign_mapping import CampaignMapping
from app.models.lead_campaign import LeadCampaign
from app.models.call_log import CallLog
from app.services.whatsapp_conversation_service import get_whatsapp_conversation_service
from app.services.dealership_twilio_config_service import get_effective_twilio_config
from app.core.websocket_manager import ws_manager
from app.core.timezone import utc_now

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
    template_name: Optional[str] = Field(None, description="Template display name for UI")

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
    media_urls: List[str] = []
    media_content_types: List[str] = []

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


# Unknown conversations models
class UnknownConversationItem(BaseModel):
    phone_number: str
    display_name: str
    last_message: dict
    unread_count: int
    dealership_id: Optional[str] = None


class UnknownConversationsListResponse(BaseModel):
    items: List[UnknownConversationItem]
    total_unread: int


class CreateLeadFromUnknownRequest(BaseModel):
    phone_number: str = Field(..., description="The WhatsApp phone number")
    first_name: Optional[str] = Field(None, description="Customer first name")
    last_name: Optional[str] = Field(None, description="Customer last name")
    email: Optional[str] = Field(None, description="Customer email")
    notes: Optional[str] = Field(None, description="Notes for the new lead")
    assigned_to: Optional[UUID] = Field(None, description="Salesperson ID to assign the lead to")


class CreateLeadFromUnknownResponse(BaseModel):
    success: bool
    lead_id: Optional[UUID] = None
    customer_id: Optional[UUID] = None
    message: Optional[str] = None
    is_existing: bool = False


class SessionWindowResponse(BaseModel):
    within_window: bool
    last_inbound_at: Optional[datetime] = None


class CallLogResponse(BaseModel):
    id: UUID
    direction: str
    from_number: str
    to_number: str
    status: str
    duration_seconds: int
    recording_url: Optional[str] = None
    recording_duration_seconds: Optional[int] = None
    notes: Optional[str] = None
    outcome: Optional[str] = None
    started_at: datetime
    answered_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TimelineItem(BaseModel):
    """Unified timeline item - can be a message or a call"""
    item_type: str  # "message" | "call"
    id: UUID
    created_at: datetime
    message: Optional[WhatsAppMessageResponse] = None
    call: Optional[CallLogResponse] = None


class TimelineResponse(BaseModel):
    lead_id: UUID
    lead_name: str
    lead_phone: Optional[str]
    items: List[TimelineItem]
    has_more: bool = False


class WhatsAppTemplateItem(BaseModel):
    id: UUID
    content_sid: str
    name: str
    variable_names: List[str]
    dealership_id: Optional[UUID] = None


class WhatsAppTemplatesListResponse(BaseModel):
    items: List[WhatsAppTemplateItem]


class CreateWhatsAppTemplateRequest(BaseModel):
    content_sid: str = Field(..., min_length=1, max_length=64, description="Twilio Content SID (e.g., HX...)")
    name: str = Field(..., min_length=1, max_length=255, description="Template display name")
    variable_names: List[str] = Field(default_factory=list, description="Variable placeholder keys e.g. ['1', '2']")
    dealership_id: Optional[UUID] = Field(None, description="Dealership ID (null for global template)")


class UpdateWhatsAppTemplateRequest(BaseModel):
    content_sid: Optional[str] = Field(None, min_length=1, max_length=64)
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    variable_names: Optional[List[str]] = None
    dealership_id: Optional[UUID] = None


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
            # Use whatsapp field (full E.164) if available, otherwise phone
            lead_phone=lead.customer.whatsapp or lead.customer.phone if lead.customer else None,
        )
        for lead in leads
    ]


@router.get("/config", response_model=WhatsAppConfigResponse)
async def get_whatsapp_config(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    effective = await get_effective_twilio_config(db, current_user.dealership_id)
    return WhatsAppConfigResponse(
        whatsapp_enabled=effective.is_whatsapp_ready(),
        phone_number=effective.whatsapp_from_number if effective.is_whatsapp_ready() else None,
    )


@router.get("/diagnostics/ffmpeg")
async def check_ffmpeg_status(
    current_user: User = Depends(deps.get_current_active_user),
):
    """Check if ffmpeg is installed and working on the server."""
    import shutil
    import subprocess
    import asyncio
    
    result = {
        "ffmpeg_installed": False,
        "ffmpeg_path": None,
        "ffmpeg_version": None,
        "aac_encoder_available": False,
        "error": None,
    }
    
    # Check if ffmpeg is in PATH
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        result["error"] = "ffmpeg not found in PATH"
        return result
    
    result["ffmpeg_installed"] = True
    result["ffmpeg_path"] = ffmpeg_path
    
    # Get ffmpeg version
    try:
        def _get_version():
            proc = subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True,
                timeout=5
            )
            return proc.stdout.decode().split("\n")[0] if proc.stdout else "unknown"
        
        result["ffmpeg_version"] = await asyncio.to_thread(_get_version)
    except Exception as e:
        result["error"] = f"Failed to get version: {e}"
        return result
    
    # Check if AAC encoder is available
    try:
        def _check_aac():
            proc = subprocess.run(
                ["ffmpeg", "-encoders"],
                capture_output=True,
                timeout=5
            )
            output = proc.stdout.decode() if proc.stdout else ""
            return "aac" in output.lower()
        
        result["aac_encoder_available"] = await asyncio.to_thread(_check_aac)
    except Exception as e:
        result["error"] = f"Failed to check encoders: {e}"
    
    return result


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
                dealership_id=t.dealership_id,
            )
            for t in templates
        ]
    )


@router.post("/templates", response_model=WhatsAppTemplateItem, status_code=status.HTTP_201_CREATED)
async def create_whatsapp_template(
    request: CreateWhatsAppTemplateRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new WhatsApp template. Admin/Owner only.
    - Super Admin can create global templates (dealership_id=null) or for any dealership
    - Dealership Admin/Owner can only create templates for their own dealership
    """
    if current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create templates"
        )

    # Check permissions for dealership_id
    if current_user.role != UserRole.SUPER_ADMIN:
        if request.dealership_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only super admin can create global templates"
            )
        if request.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot create templates for other dealerships"
            )

    # Check if content_sid already exists
    existing = await db.execute(
        select(WhatsAppTemplate).where(WhatsAppTemplate.content_sid == request.content_sid)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Template with content_sid {request.content_sid} already exists"
        )

    template = WhatsAppTemplate(
        content_sid=request.content_sid,
        name=request.name,
        variable_names=request.variable_names,
        dealership_id=request.dealership_id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    logger.info(f"WhatsApp template created: {template.id} by user {current_user.id}")

    return WhatsAppTemplateItem(
        id=template.id,
        content_sid=template.content_sid,
        name=template.name,
        variable_names=template.variable_names or [],
        dealership_id=template.dealership_id,
    )


@router.get("/templates/{template_id}", response_model=WhatsAppTemplateItem)
async def get_whatsapp_template(
    template_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single WhatsApp template by ID."""
    result = await db.execute(
        select(WhatsAppTemplate).where(WhatsAppTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    # Check access - user can see global templates or their dealership's templates
    if template.dealership_id is not None:
        if current_user.role != UserRole.SUPER_ADMIN and template.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return WhatsAppTemplateItem(
        id=template.id,
        content_sid=template.content_sid,
        name=template.name,
        variable_names=template.variable_names or [],
        dealership_id=template.dealership_id,
    )


@router.put("/templates/{template_id}", response_model=WhatsAppTemplateItem)
async def update_whatsapp_template(
    template_id: UUID,
    request: UpdateWhatsAppTemplateRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a WhatsApp template. Admin/Owner only.
    - Super Admin can update any template
    - Dealership Admin/Owner can only update their dealership's templates
    """
    if current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can update templates"
        )

    result = await db.execute(
        select(WhatsAppTemplate).where(WhatsAppTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    # Check permissions
    if current_user.role != UserRole.SUPER_ADMIN:
        if template.dealership_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only super admin can update global templates"
            )
        if template.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot update templates from other dealerships"
            )

    # Check content_sid uniqueness if changing
    if request.content_sid and request.content_sid != template.content_sid:
        existing = await db.execute(
            select(WhatsAppTemplate).where(
                WhatsAppTemplate.content_sid == request.content_sid,
                WhatsAppTemplate.id != template_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Template with content_sid {request.content_sid} already exists"
            )
        template.content_sid = request.content_sid

    if request.name is not None:
        template.name = request.name
    if request.variable_names is not None:
        template.variable_names = request.variable_names
    if request.dealership_id is not None:
        # Only super admin can change dealership assignment
        if current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only super admin can change template dealership"
            )
        template.dealership_id = request.dealership_id

    await db.commit()
    await db.refresh(template)

    logger.info(f"WhatsApp template updated: {template.id} by user {current_user.id}")

    return WhatsAppTemplateItem(
        id=template.id,
        content_sid=template.content_sid,
        name=template.name,
        variable_names=template.variable_names or [],
        dealership_id=template.dealership_id,
    )


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_whatsapp_template(
    template_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a WhatsApp template. Admin/Owner only.
    - Super Admin can delete any template
    - Dealership Admin/Owner can only delete their dealership's templates
    """
    if current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete templates"
        )

    result = await db.execute(
        select(WhatsAppTemplate).where(WhatsAppTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    # Check permissions
    if current_user.role != UserRole.SUPER_ADMIN:
        if template.dealership_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only super admin can delete global templates"
            )
        if template.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete templates from other dealerships"
            )

    await db.delete(template)
    await db.commit()

    logger.info(f"WhatsApp template deleted: {template_id} by user {current_user.id}")

    return None


@router.post("/send", response_model=SendWhatsAppResponse)
async def send_whatsapp(
    request: SendWhatsAppRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    effective = await get_effective_twilio_config(db, current_user.dealership_id)
    if not effective.is_whatsapp_ready():
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
            template_name=request.template_name,
        )
    else:
        if request.lead_id:
            lead_result = await db.execute(select(Lead).where(Lead.id == request.lead_id))
            lead_for_window = lead_result.scalar_one_or_none()
            if not lead_for_window:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
            if current_user.role == UserRole.SALESPERSON and lead_for_window.assigned_to != current_user.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
                if current_user.dealership_id and lead_for_window.dealership_id != current_user.dealership_id:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            if not await service.is_within_whatsapp_session_window(request.lead_id):
                return SendWhatsAppResponse(
                    success=False,
                    error=(
                        "Outside the 24-hour WhatsApp session window. "
                        "Send a template message instead."
                    ),
                    error_code="OUTSIDE_SESSION_WINDOW",
                )
        success, wa_log, error = await service.send_whatsapp(
            to_number=request.to_number,
            body=request.body or "",
            user_id=current_user.id,
            lead_id=request.lead_id,
            dealership_id=current_user.dealership_id,
        )
    await db.commit()
    if success and wa_log:
        if wa_log.lead_id and wa_log.dealership_id:
            try:
                await ws_manager.broadcast_to_dealership(
                    str(wa_log.dealership_id),
                    {
                        "type": "whatsapp:sent",
                        "payload": {
                            "message_id": str(wa_log.id),
                            "lead_id": str(wa_log.lead_id),
                            "body_preview": wa_log.body[:50] if wa_log.body else "",
                            "has_media": bool(wa_log.media_urls),
                            # Full message object for instant UI updates
                            "message": {
                                "id": str(wa_log.id),
                                "lead_id": str(wa_log.lead_id),
                                "user_id": str(wa_log.user_id) if wa_log.user_id else None,
                                "direction": wa_log.direction.value,
                                "from_number": wa_log.from_number,
                                "to_number": wa_log.to_number,
                                "body": wa_log.body,
                                "status": wa_log.status.value,
                                "is_read": wa_log.is_read,
                                "created_at": wa_log.created_at.isoformat() if wa_log.created_at else None,
                                "sent_at": wa_log.sent_at.isoformat() if wa_log.sent_at else None,
                                "delivered_at": wa_log.delivered_at.isoformat() if wa_log.delivered_at else None,
                                "media_urls": wa_log.media_urls or [],
                                "media_content_types": wa_log.media_content_types or [],
                            },
                        }
                    }
                )
            except Exception as e:
                logger.warning("whatsapp:sent broadcast failed: %s", e)
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


# ==================== Unknown Conversations ====================

@router.get("/unknown", response_model=UnknownConversationsListResponse)
async def list_unknown_conversations(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """List WhatsApp conversations from unknown numbers (not linked to any lead).
    
    These are messages from numbers that don't match any existing customer/lead.
    Users can review these and optionally create leads from them.
    """
    service = get_whatsapp_conversation_service(db)
    dealership_id = current_user.dealership_id
    
    conversations = await service.get_unknown_conversations_list(
        dealership_id=dealership_id,
        limit=limit,
        offset=offset
    )
    total_unread = await service.get_unknown_unread_count(
        dealership_id=dealership_id
    )
    return UnknownConversationsListResponse(
        items=[UnknownConversationItem(**c) for c in conversations],
        total_unread=total_unread
    )


@router.get("/unknown/{phone_number}/messages")
async def get_unknown_conversation_messages(
    phone_number: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all messages for an unknown conversation by phone number."""
    service = get_whatsapp_conversation_service(db)
    messages = await service.get_unknown_conversation_messages(
        phone_number=phone_number,
        dealership_id=current_user.dealership_id,
        limit=limit,
        offset=offset
    )
    return {"messages": messages, "phone_number": phone_number}


@router.post("/unknown/{phone_number}/mark-read")
async def mark_unknown_conversation_read(
    phone_number: str,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Mark all messages from an unknown phone number as read."""
    service = get_whatsapp_conversation_service(db)
    count = await service.mark_unknown_conversation_as_read(
        phone_number=phone_number,
        dealership_id=current_user.dealership_id
    )
    await db.commit()
    return {"success": True, "messages_marked": count}


@router.post("/unknown/create-lead", response_model=CreateLeadFromUnknownResponse)
async def create_lead_from_unknown(
    request: CreateLeadFromUnknownRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new lead from an unknown WhatsApp contact.
    
    This will:
    1. Check if a lead already exists with this phone number
    2. If exists, link messages to existing lead
    3. If not, create a new Customer and Lead
    4. Link all existing messages from this number to the lead
    5. The conversation will then appear in the regular conversations list
    """
    if not current_user.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must belong to a dealership"
        )
    
    service = get_whatsapp_conversation_service(db)
    
    try:
        # Check for existing lead with this phone number
        existing_lead = await service.find_lead_by_phone(request.phone_number)
        if not existing_lead:
            existing_lead = await service.find_lead_by_lead_phone_suffix(request.phone_number)
        
        if existing_lead and existing_lead.dealership_id == current_user.dealership_id:
            # Link messages to existing lead
            linked_count = await service.link_unknown_messages_to_lead(
                phone_number=request.phone_number,
                lead_id=existing_lead.id,
                customer_id=existing_lead.customer_id,
                dealership_id=current_user.dealership_id,
            )
            await db.commit()
            
            # Broadcast to refresh the UI
            await ws_manager.broadcast_to_dealership(
                str(current_user.dealership_id),
                {
                    "type": "lead:created_from_unknown",
                    "payload": {
                        "lead_id": str(existing_lead.id),
                        "customer_id": str(existing_lead.customer_id),
                        "phone_number": request.phone_number,
                        "is_existing": True,
                    }
                }
            )
            
            return CreateLeadFromUnknownResponse(
                success=True,
                lead_id=existing_lead.id,
                customer_id=existing_lead.customer_id,
                message=f"Linked {linked_count} messages to existing lead",
                is_existing=True,
            )
        
        # Create new lead
        # Use current user as assigned_to if not specified
        assigned_to = request.assigned_to or current_user.id
        
        customer, lead = await service.create_lead_from_unknown(
            phone_number=request.phone_number,
            dealership_id=current_user.dealership_id,
            first_name=request.first_name,
            last_name=request.last_name,
            email=request.email,
            notes=request.notes,
            assigned_to=assigned_to,
        )
        await db.commit()
        
        # Broadcast to refresh the UI
        await ws_manager.broadcast_to_dealership(
            str(current_user.dealership_id),
            {
                "type": "lead:created_from_unknown",
                "payload": {
                    "lead_id": str(lead.id),
                    "customer_id": str(customer.id),
                    "phone_number": request.phone_number,
                    "is_existing": False,
                }
            }
        )
        
        return CreateLeadFromUnknownResponse(
            success=True,
            lead_id=lead.id,
            customer_id=customer.id,
            message=f"Lead created successfully",
            is_existing=False,
        )
    except Exception as e:
        logger.error(f"Failed to create lead from unknown: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


class SendToUnknownRequest(BaseModel):
    phone_number: str = Field(..., description="The WhatsApp phone number to send to")
    body: Optional[str] = Field(None, description="Message body (for session messages)")
    content_sid: Optional[str] = Field(None, description="Template Content SID for template messages")
    content_variables: Optional[Dict[str, str]] = Field(None, description="Template variables")


@router.post("/unknown/{phone_number}/send", response_model=SendWhatsAppResponse)
async def send_to_unknown_contact(
    phone_number: str,
    request: SendToUnknownRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Send a WhatsApp message to an unknown contact (not linked to any lead).
    This allows salespeople to chat with unknown contacts to qualify them
    before adding them as leads.
    """
    if not current_user.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must belong to a dealership"
        )
    
    effective = await get_effective_twilio_config(db, current_user.dealership_id)
    if not effective.is_whatsapp_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp is not configured"
        )
    
    # Normalize phone number
    normalized_phone = "".join(c for c in phone_number if c.isdigit())
    if len(normalized_phone) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number"
        )
    
    service = get_whatsapp_conversation_service(db)
    
    try:
        if request.content_sid:
            # Send template message
            success, wa_log, error = await service.send_whatsapp_template(
                to_number=phone_number,
                content_sid=request.content_sid,
                content_variables=request.content_variables or {},
                user_id=current_user.id,
                lead_id=None,  # No lead
                dealership_id=current_user.dealership_id,
            )
        else:
            # Send session message
            if not request.body:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Message body is required for session messages"
                )
            success, wa_log, error = await service.send_whatsapp(
                to_number=phone_number,
                body=request.body,
                user_id=current_user.id,
                lead_id=None,  # No lead
                dealership_id=current_user.dealership_id,
            )
        
        if not success:
            return SendWhatsAppResponse(success=False, error=error)
        
        await db.commit()
        
        # Broadcast to update UI
        if wa_log:
            await ws_manager.broadcast_to_dealership(
                str(current_user.dealership_id),
                {
                    "type": "whatsapp:unknown_sent",
                    "payload": {
                        "message_id": str(wa_log.id),
                        "phone_number": phone_number,
                        "body_preview": (request.body or "")[:100],
                        "message": {
                            "id": str(wa_log.id),
                            "direction": "outbound",
                            "from_number": wa_log.from_number,
                            "to_number": wa_log.to_number,
                            "body": wa_log.body,
                            "status": wa_log.status.value,
                            "is_read": True,
                            "created_at": wa_log.created_at.isoformat() if wa_log.created_at else None,
                        },
                    },
                },
            )
        
        return SendWhatsAppResponse(
            success=True,
            message_id=wa_log.id if wa_log else None,
        )
    except Exception as e:
        logger.error(f"Failed to send to unknown contact {phone_number}: {e}", exc_info=True)
        return SendWhatsAppResponse(success=False, error=str(e))


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
    # Use whatsapp field (full E.164) if available, otherwise phone
    lead_whatsapp = lead.customer.whatsapp if lead.customer else None
    return WhatsAppConversationResponse(
        lead_id=lead.id,
        lead_name=f"{lead.first_name} {lead.last_name or ''}".strip(),
        lead_phone=lead_whatsapp or lead.phone,
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
                delivered_at=msg.delivered_at,
                media_urls=msg.media_urls or [],
                media_content_types=msg.media_content_types or [],
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
    within_window, last_inbound_at = await service.get_session_window_state(lead_id)
    return SessionWindowResponse(within_window=within_window, last_inbound_at=last_inbound_at)


@router.get("/conversations/{lead_id}/timeline", response_model=TimelineResponse)
async def get_whatsapp_timeline(
    lead_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[datetime] = Query(None, description="Load messages before this timestamp (for pagination)"),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a unified timeline of WhatsApp messages and voice calls for a lead.
    Items are sorted by timestamp, oldest first for display.
    
    Pagination: Use `before` parameter to load older messages.
    - First load: no `before` param, returns most recent messages
    - Load more: pass the `created_at` of the oldest message as `before`
    """
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

    # Fetch WhatsApp messages - get messages BEFORE the cursor (older messages)
    msg_query = select(WhatsAppLog).where(WhatsAppLog.lead_id == lead_id)
    if before:
        msg_query = msg_query.where(WhatsAppLog.created_at < before)
    msg_query = msg_query.order_by(WhatsAppLog.created_at.desc()).limit(limit + 1)  # +1 to check has_more
    msg_result = await db.execute(msg_query)
    messages = list(msg_result.scalars().all())

    # Fetch call logs - same pagination
    call_query = select(CallLog).where(CallLog.lead_id == lead_id)
    if before:
        call_query = call_query.where(CallLog.started_at < before)
    call_query = call_query.order_by(CallLog.started_at.desc()).limit(limit + 1)
    call_result = await db.execute(call_query)
    calls = list(call_result.scalars().all())

    # Build timeline items from messages
    timeline_items: List[TimelineItem] = []
    
    for msg in messages:
        timeline_items.append(TimelineItem(
            item_type="message",
            id=msg.id,
            created_at=msg.created_at,
            message=WhatsAppMessageResponse(
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
                media_urls=msg.media_urls or [],
                media_content_types=msg.media_content_types or [],
            ),
        ))

    for call in calls:
        timeline_items.append(TimelineItem(
            item_type="call",
            id=call.id,
            created_at=call.started_at,
            call=CallLogResponse(
                id=call.id,
                direction=call.direction.value,
                from_number=call.from_number,
                to_number=call.to_number,
                status=call.status.value,
                duration_seconds=call.duration_seconds,
                recording_url=call.recording_url,
                recording_duration_seconds=call.recording_duration_seconds,
                notes=call.notes,
                outcome=call.outcome,
                started_at=call.started_at,
                answered_at=call.answered_at,
                ended_at=call.ended_at,
            ),
        ))

    # Sort by created_at descending (newest first) for pagination logic
    timeline_items.sort(key=lambda x: x.created_at, reverse=True)
    
    # Check if there are more items (we fetched limit+1)
    has_more = len(timeline_items) > limit
    
    # Trim to limit and reverse for oldest-first display
    display_items = timeline_items[:limit]
    display_items.reverse()  # Now oldest first for chat display

    # Mark messages as read (only on initial load, not pagination)
    if not before:
        service = get_whatsapp_conversation_service(db)
        await service.mark_conversation_as_read(lead_id)
        await db.commit()

    # Use whatsapp field (full E.164) if available, otherwise phone
    lead_whatsapp = lead.customer.whatsapp if lead.customer else None
    return TimelineResponse(
        lead_id=lead.id,
        lead_name=f"{lead.first_name} {lead.last_name or ''}".strip(),
        lead_phone=lead_whatsapp or lead.phone,
        items=display_items,
        has_more=has_more,
    )


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
            template_name=request.template_name,
        )
    else:
        if not await service.is_within_whatsapp_session_window(lead_id):
            return SendWhatsAppResponse(
                success=False,
                error=(
                    "Outside the 24-hour WhatsApp session window. "
                    "Send a template message instead."
                ),
                error_code="OUTSIDE_SESSION_WINDOW",
            )
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
            try:
                await ws_manager.broadcast_to_dealership(
                    str(lead.dealership_id),
                    {
                        "type": "whatsapp:sent",
                        "payload": {
                            "message_id": str(wa_log.id),
                            "lead_id": str(lead.id),
                            "body_preview": wa_log.body[:50] if wa_log.body else "",
                            "has_media": bool(wa_log.media_urls),
                            # Full message object for instant UI updates
                            "message": {
                                "id": str(wa_log.id),
                                "lead_id": str(wa_log.lead_id),
                                "user_id": str(wa_log.user_id) if wa_log.user_id else None,
                                "direction": wa_log.direction.value,
                                "from_number": wa_log.from_number,
                                "to_number": wa_log.to_number,
                                "body": wa_log.body,
                                "status": wa_log.status.value,
                                "is_read": wa_log.is_read,
                                "created_at": wa_log.created_at.isoformat() if wa_log.created_at else None,
                                "sent_at": wa_log.sent_at.isoformat() if wa_log.sent_at else None,
                                "delivered_at": wa_log.delivered_at.isoformat() if wa_log.delivered_at else None,
                                "media_urls": wa_log.media_urls or [],
                                "media_content_types": wa_log.media_content_types or [],
                            },
                        }
                    }
                )
            except Exception as e:
                logger.warning("whatsapp:sent broadcast failed: %s", e)
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
        media_urls=msg.media_urls or [],
        media_content_types=msg.media_content_types or [],
        twilio_message_sid=msg.twilio_message_sid if not str(msg.twilio_message_sid or "").startswith("pending_") else None,
        error_code=msg.error_code,
        error_message=msg.error_message,
    )


@router.get("/media/{message_id}/{media_index}")
async def get_whatsapp_media(
    message_id: UUID,
    media_index: int,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Proxy endpoint to fetch WhatsApp media from Twilio.
    Twilio media URLs require authentication, so we proxy through the backend.
    """
    result = await db.execute(
        select(WhatsAppLog).where(WhatsAppLog.id == message_id)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    
    # Check access permissions
    if current_user.role == UserRole.SALESPERSON and msg.lead_id:
        lead = (await db.execute(select(Lead).where(Lead.id == msg.lead_id))).scalar_one_or_none()
        if lead and lead.assigned_to != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    media_urls = msg.media_urls or []
    media_types = msg.media_content_types or []
    
    if media_index < 0 or media_index >= len(media_urls):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    
    media_url = media_urls[media_index]
    stored_content_type = media_types[media_index] if media_index < len(media_types) else ""
    
    # Try to guess content type from URL extension if not stored properly
    def guess_content_type_from_url(url: str) -> str:
        url_lower = url.lower().split("?")[0]  # Remove query params
        ext_map = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp",
            ".mp4": "video/mp4", ".3gpp": "video/3gpp", ".3gp": "video/3gpp",
            ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".amr": "audio/amr",
            ".aac": "audio/aac", ".opus": "audio/ogg",
            ".pdf": "application/pdf",
        }
        for ext, mime in ext_map.items():
            if url_lower.endswith(ext):
                return mime
        return ""
    
    # Determine content type: stored > guessed from URL > fallback
    content_type = stored_content_type
    if not content_type or content_type == "application/octet-stream":
        guessed = guess_content_type_from_url(media_url)
        if guessed:
            content_type = guessed
            logger.info(f"Guessed content-type from URL extension: {content_type}")
        else:
            content_type = "application/octet-stream"
    
    # Determine if this is a Twilio URL (needs auth) or Azure/public URL (no auth)
    is_twilio_url = "twilio.com" in media_url or "api.twilio.com" in media_url
    
    async def stream_media():
        async with httpx.AsyncClient(timeout=30.0) as client:
            auth = None
            if is_twilio_url:
                # Twilio media URLs require Basic auth with account SID and auth token
                effective = await get_effective_twilio_config(db, current_user.dealership_id)
                if effective.account_sid and effective.auth_token:
                    auth = (effective.account_sid, effective.auth_token)
            
            try:
                async with client.stream("GET", media_url, auth=auth, follow_redirects=True) as response:
                    if response.status_code != 200:
                        logger.warning(f"Failed to fetch media (status {response.status_code}): {media_url[:100]}")
                        return
                    
                    # Try to get actual content type from response if we don't have it
                    actual_content_type = response.headers.get("content-type", content_type)
                    if content_type == "application/octet-stream" and actual_content_type != "application/octet-stream":
                        # Update our knowledge but we can't change the response headers at this point
                        logger.info(f"Media has actual content-type: {actual_content_type}")
                    
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        yield chunk
            except Exception as e:
                logger.error(f"Error streaming media: {e}")
                return
    
    # For better content type detection, try to get it from response headers
    # by doing a HEAD request first for non-octet-stream types
    final_content_type = content_type
    if content_type == "application/octet-stream":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                auth = None
                if is_twilio_url:
                    effective = await get_effective_twilio_config(db, current_user.dealership_id)
                    if effective.account_sid and effective.auth_token:
                        auth = (effective.account_sid, effective.auth_token)
                head_response = await client.head(media_url, auth=auth, follow_redirects=True)
                if head_response.status_code == 200:
                    detected = head_response.headers.get("content-type", "").split(";")[0].strip()
                    if detected and detected != "application/octet-stream":
                        final_content_type = detected
                        logger.info(f"Detected content-type from HEAD: {final_content_type}")
        except Exception as e:
            logger.debug(f"HEAD request failed, using stored content-type: {e}")
    
    return StreamingResponse(
        stream_media(),
        media_type=final_content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": "inline",
        }
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


# ======================= MEDIA UPLOAD AND SEND =======================

ALLOWED_MEDIA_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/3gpp",
    "audio/ogg", "audio/mpeg", "audio/amr", "audio/aac", "audio/webm", "audio/wav", "audio/mp4", "audio/m4a",
    "application/pdf",
}
MAX_MEDIA_SIZE = 16 * 1024 * 1024  # 16MB


class UploadMediaResponse(BaseModel):
    url: str
    content_type: str
    filename: str


class SendMediaRequest(BaseModel):
    media_url: str = Field(..., description="Public URL of media (after upload)")
    content_type: Optional[str] = Field(None, description="MIME type of the media (e.g., image/jpeg)")
    caption: Optional[str] = Field(None, max_length=1024, description="Optional caption")


def _convert_audio_to_ogg_sync(content: bytes, source_format: str = "webm") -> tuple[bytes, str]:
    """Synchronous audio conversion to OGG format using ffmpeg."""
    import tempfile
    import subprocess
    import os
    import shutil
    
    # Check if ffmpeg is available
    if not shutil.which("ffmpeg"):
        raise Exception("ffmpeg not installed")
    
    # Create temp files for input and output
    with tempfile.NamedTemporaryFile(suffix=f".{source_format}", delete=False) as infile:
        infile.write(content)
        input_path = infile.name
    
    output_path = input_path.rsplit(".", 1)[0] + ".ogg"
    
    try:
        # Convert using ffmpeg with WhatsApp-compatible settings
        # WhatsApp requires: OGG container, Opus codec, 48000Hz sample rate, mono channel
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-c:a", "libopus",
                "-b:a", "64k",
                "-ar", "48000",
                "-ac", "1",
                "-application", "voip",
                output_path
            ],
            capture_output=True,
            timeout=30
        )
        
        if result.returncode != 0:
            stderr = result.stderr.decode() if result.stderr else "Unknown error"
            logger.error(f"ffmpeg conversion failed: {stderr}")
            raise Exception(f"ffmpeg conversion failed: {stderr}")
        
        # Verify output file exists and has content
        if not os.path.exists(output_path):
            raise Exception("ffmpeg did not create output file")
        
        output_size = os.path.getsize(output_path)
        if output_size == 0:
            raise Exception("ffmpeg created empty output file")
        
        logger.info(f"Audio conversion successful: {output_size} bytes")
        
        with open(output_path, "rb") as f:
            converted_content = f.read()
        
        return converted_content, "audio/ogg"
    finally:
        # Clean up temp files
        if os.path.exists(input_path):
            os.unlink(input_path)
        if os.path.exists(output_path):
            os.unlink(output_path)


async def convert_audio_to_ogg(content: bytes, source_format: str = "webm") -> tuple[bytes, str]:
    """Convert audio to OGG format (supported by WhatsApp) using ffmpeg via subprocess."""
    import asyncio
    return await asyncio.to_thread(_convert_audio_to_ogg_sync, content, source_format)


def _convert_audio_to_mp3_sync(content: bytes, source_format: str = "webm") -> tuple[bytes, str]:
    """Synchronous audio conversion to MP3 format using ffmpeg.
    
    MP3 is universally supported by WhatsApp and most reliable for voice messages.
    """
    import tempfile
    import subprocess
    import os
    import shutil
    
    # Check if ffmpeg is available
    if not shutil.which("ffmpeg"):
        raise Exception("ffmpeg not installed")
    
    # Create temp files for input and output
    with tempfile.NamedTemporaryFile(suffix=f".{source_format}", delete=False) as infile:
        infile.write(content)
        input_path = infile.name
    
    output_path = input_path.rsplit(".", 1)[0] + ".mp3"
    
    try:
        # Convert using ffmpeg to MP3 (universally supported by WhatsApp)
        # -c:a libmp3lame = MP3 encoder
        # -b:a 128k = good quality bitrate
        # -ar 44100 = standard sample rate
        # -ac 1 = mono (voice)
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-c:a", "libmp3lame",
                "-b:a", "128k",
                "-ar", "44100",
                "-ac", "1",
                output_path
            ],
            capture_output=True,
            timeout=30
        )
        
        if result.returncode != 0:
            stderr = result.stderr.decode() if result.stderr else "Unknown error"
            logger.error(f"ffmpeg MP3 conversion failed: {stderr}")
            raise Exception(f"ffmpeg MP3 conversion failed: {stderr}")
        
        # Verify output file exists and has content
        if not os.path.exists(output_path):
            raise Exception("ffmpeg did not create output file")
        
        output_size = os.path.getsize(output_path)
        if output_size == 0:
            raise Exception("ffmpeg created empty output file")
        
        logger.info(f"Audio MP3 conversion successful: {output_size} bytes")
        
        with open(output_path, "rb") as f:
            converted_content = f.read()
        
        return converted_content, "audio/mpeg"
    finally:
        # Clean up temp files
        if os.path.exists(input_path):
            os.unlink(input_path)
        if os.path.exists(output_path):
            os.unlink(output_path)


async def convert_audio_to_mp3(content: bytes, source_format: str = "webm") -> tuple[bytes, str]:
    """Convert audio to MP3 format (universally supported by WhatsApp) using ffmpeg via subprocess."""
    import asyncio
    return await asyncio.to_thread(_convert_audio_to_mp3_sync, content, source_format)


@router.post("/upload-media", response_model=UploadMediaResponse)
async def upload_whatsapp_media(
    file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload media file for sending via WhatsApp.
    Returns a public URL that can be used with send-media endpoint.
    
    Supported types: images (JPEG, PNG, GIF, WebP), videos (MP4, 3GPP),
    audio (OGG, MP3, AMR, AAC), documents (PDF)
    Max size: 16MB
    
    Note: audio/webm files are automatically converted to audio/ogg for WhatsApp compatibility.
    """
    from app.services.azure_storage_service import azure_storage_service

    if not azure_storage_service.is_whatsapp_media_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Media storage not configured"
        )

    # Get content type and extract base type (without parameters like codecs)
    raw_content_type = file.content_type or "application/octet-stream"
    # Extract base MIME type (e.g., "audio/webm;codecs=opus" -> "audio/webm")
    content_type = raw_content_type.split(";")[0].strip()
    
    if content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported media type: {content_type}. Allowed: {', '.join(ALLOWED_MEDIA_TYPES)}"
        )

    # Read file content
    content = await file.read()
    if len(content) > MAX_MEDIA_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size: {MAX_MEDIA_SIZE // (1024*1024)}MB"
        )

    # Convert webm/wav to AAC (WhatsApp natively supports AAC/MP4)
    # Skip conversion for audio/mp4 and audio/m4a - WhatsApp accepts these natively
    original_filename = file.filename or "media"
    # Convert ALL browser-recorded audio to AAC-LC for WhatsApp compatibility
    # Safari may output HE-AAC or other codecs that WhatsApp rejects
    # Chrome/Firefox output webm/opus which also needs conversion
    audio_formats_to_convert = {"audio/webm", "audio/wav", "audio/mp4", "audio/x-m4a", "audio/m4a"}
    logger.info(f"Upload media: content_type={content_type}, filename={original_filename}, size={len(content)} bytes")
    
    if content_type in audio_formats_to_convert:
        logger.info(f"Audio conversion needed: {content_type} -> audio/mpeg (MP3)")
        format_map = {
            "audio/webm": "webm",
            "audio/wav": "wav",
            "audio/mp4": "mp4",
            "audio/x-m4a": "m4a",
            "audio/m4a": "m4a",
        }
        source_format = format_map.get(content_type, "mp4")
        logger.info(f"Converting from {source_format} ({content_type}) to MP3... Input size: {len(content)} bytes")
        
        try:
            converted_content, converted_type = await convert_audio_to_mp3(content, source_format)
            
            # Verify conversion produced valid output
            if len(converted_content) < 100:
                raise Exception(f"Converted file too small: {len(converted_content)} bytes")
            
            content = converted_content
            content_type = converted_type
            logger.info(f"Conversion successful: output size={len(content)} bytes, content_type={content_type}")
            
            # Update filename extension to .mp3 (universally supported)
            ext_to_remove = [".webm", ".wav", ".mp4", ".m4a"]
            base_name = original_filename
            for ext in ext_to_remove:
                if original_filename.lower().endswith(ext):
                    base_name = original_filename[:-len(ext)]
                    break
            original_filename = base_name + ".mp3"
            
        except Exception as e:
            logger.error(f"Audio conversion FAILED: {e}", exc_info=True)
            # DO NOT fall back - WhatsApp won't accept unconverted audio
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Audio conversion failed: {str(e)}. Please ensure ffmpeg is installed on the server."
            )

    # Upload to Azure
    url = await azure_storage_service.upload_whatsapp_media(
        data=content,
        filename=original_filename,
        content_type=content_type,
        dealership_id=current_user.dealership_id,
    )

    if not url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload media"
        )

    return UploadMediaResponse(
        url=url,
        content_type=content_type,
        filename=original_filename,
    )


@router.post("/conversations/{lead_id}/send-media", response_model=SendWhatsAppResponse)
async def send_whatsapp_media_to_lead(
    lead_id: UUID,
    request: SendMediaRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Send media (image, video, audio, document) to a lead via WhatsApp.
    First upload the media using /upload-media, then call this with the returned URL.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if not lead.phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead has no phone number")
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    effective = await get_effective_twilio_config(db, lead.dealership_id)
    if not effective.is_whatsapp_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp is not configured"
        )

    logger.info(f"Sending media to lead: url={request.media_url}, content_type={request.content_type}")

    # Verify the media URL is accessible (Twilio needs to fetch it)
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            head_response = await http_client.head(request.media_url)
            if head_response.status_code != 200:
                logger.error(f"Media URL not accessible: status={head_response.status_code}, url={request.media_url}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Media URL not accessible (status {head_response.status_code}). Twilio won't be able to fetch it."
                )
            azure_content_type = head_response.headers.get("content-type", "unknown")
            azure_content_length = head_response.headers.get("content-length", "unknown")
            logger.info(f"Media URL verified accessible: content-type={azure_content_type}, size={azure_content_length}")
    except httpx.RequestError as e:
        logger.error(f"Failed to verify media URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot verify media URL is accessible: {str(e)}"
        )

    # Send via Twilio with MediaUrl
    try:
        from twilio.rest import Client
        import asyncio
        client = Client(effective.account_sid, effective.auth_token)

        # Run Twilio API call in thread pool to avoid blocking
        logger.info(f"Calling Twilio messages.create with media_url={request.media_url}, verified content-type={azure_content_type}")
        message = await asyncio.to_thread(
            client.messages.create,
            from_=f"whatsapp:{effective.whatsapp_from_number}",
            to=f"whatsapp:{lead.phone}",
            media_url=[request.media_url],
            body=request.caption or "",
        )
        logger.info(f"Twilio message created successfully: sid={message.sid}, status={message.status}")

        # Use content_type from request if provided, otherwise try to detect from URL
        if request.content_type:
            content_type = request.content_type
        else:
            url_lower = request.media_url.lower()
            if any(ext in url_lower for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]):
                content_type = "image/jpeg"
            elif any(ext in url_lower for ext in [".mp4", ".3gpp"]):
                content_type = "video/mp4"
            elif ".mp3" in url_lower:
                content_type = "audio/mpeg"
            elif any(ext in url_lower for ext in [".m4a"]):
                content_type = "audio/mp4"
            elif any(ext in url_lower for ext in [".ogg", ".amr", ".aac"]):
                content_type = "audio/ogg"
            else:
                content_type = "application/octet-stream"

        # Create log entry
        wa_log = WhatsAppLog(
            customer_id=lead.customer_id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
            user_id=current_user.id,
            twilio_message_sid=message.sid,
            direction=WhatsAppDirection.OUTBOUND,
            from_number=effective.whatsapp_from_number,
            to_number=lead.phone,
            body=request.caption or "",
            media_urls=[request.media_url],
            media_content_types=[content_type],
            status=WhatsAppStatus.SENT,
            sent_at=utc_now(),
            is_read=True,
        )
        db.add(wa_log)
        await db.commit()
        await db.refresh(wa_log)

        # Broadcast to WebSocket
        if lead.dealership_id:
            try:
                await ws_manager.broadcast_to_dealership(
                    str(lead.dealership_id),
                    {
                        "type": "whatsapp:sent",
                        "payload": {
                            "message_id": str(wa_log.id),
                            "lead_id": str(lead.id),
                            "body_preview": request.caption[:50] if request.caption else "[Media]",
                            "has_media": True,
                            "message": {
                                "id": str(wa_log.id),
                                "lead_id": str(wa_log.lead_id),
                                "user_id": str(wa_log.user_id) if wa_log.user_id else None,
                                "direction": wa_log.direction.value,
                                "from_number": wa_log.from_number,
                                "to_number": wa_log.to_number,
                                "body": wa_log.body,
                                "status": wa_log.status.value,
                                "is_read": wa_log.is_read,
                                "created_at": wa_log.created_at.isoformat() if wa_log.created_at else None,
                                "sent_at": wa_log.sent_at.isoformat() if wa_log.sent_at else None,
                                "delivered_at": wa_log.delivered_at.isoformat() if wa_log.delivered_at else None,
                                "media_urls": wa_log.media_urls or [],
                                "media_content_types": wa_log.media_content_types or [],
                            },
                        }
                    }
                )
            except Exception as e:
                logger.warning("whatsapp:sent media broadcast failed: %s", e)

        return SendWhatsAppResponse(success=True, message_id=wa_log.id)

    except Exception as e:
        logger.error(f"Failed to send WhatsApp media: {e}")
        return SendWhatsAppResponse(
            success=False,
            error=str(e),
        )


# ======================= BULK SEND =======================

class BulkSendRequest(BaseModel):
    """Request to send WhatsApp template to multiple leads."""
    campaign_mapping_id: Optional[UUID] = Field(None, description="Filter leads by campaign mapping ID")
    lead_ids: Optional[List[UUID]] = Field(None, description="Explicit list of lead IDs (max 500)")
    content_sid: str = Field(..., description="Twilio Content SID for the template")
    content_variables: Dict[str, str] = Field(
        default_factory=dict,
        description="Template variables - use {{lead_name}}, {{first_name}}, etc. for dynamic values"
    )
    name: Optional[str] = Field(None, max_length=255, description="Optional name for this bulk send")

    @model_validator(mode="after")
    def validate_target(self):
        if not self.campaign_mapping_id and not self.lead_ids:
            raise ValueError("Provide either campaign_mapping_id or lead_ids")
        if self.lead_ids and len(self.lead_ids) > 500:
            raise ValueError("Maximum 500 leads per bulk send")
        return self


class BulkSendResponse(BaseModel):
    """Response from bulk send initiation."""
    id: UUID
    status: str
    total_recipients: int
    message: str


class BulkSendStatusResponse(BaseModel):
    """Status of a bulk send operation."""
    id: UUID
    name: Optional[str]
    status: str
    total_recipients: int
    sent_count: int
    delivered_count: int
    failed_count: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime


@router.post("/bulk-send", response_model=BulkSendResponse)
async def initiate_bulk_send(
    request: BulkSendRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Initiate a bulk WhatsApp template send to leads.
    
    - Admin/Owner only
    - Provide either campaign_mapping_id (sends to all leads in that campaign) or explicit lead_ids
    - content_variables can include placeholders like {{first_name}}, {{lead_name}} which will be replaced per-lead
    
    The actual sends are queued and processed in the background.
    """
    if current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can initiate bulk sends"
        )

    # Verify template exists
    template_result = await db.execute(
        select(WhatsAppTemplate).where(WhatsAppTemplate.content_sid == request.content_sid)
    )
    template = template_result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template with content_sid {request.content_sid} not found"
        )

    # Build lead query
    lead_query = select(Lead).where(Lead.phone.isnot(None), Lead.phone != "")

    # Filter by dealership for non-super-admins
    if current_user.role != UserRole.SUPER_ADMIN:
        if not current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User not assigned to a dealership"
            )
        lead_query = lead_query.where(Lead.dealership_id == current_user.dealership_id)

    if request.lead_ids:
        lead_query = lead_query.where(Lead.id.in_(request.lead_ids))
    elif request.campaign_mapping_id:
        # Get leads matching this campaign mapping
        lead_query = lead_query.where(
            or_(
                Lead.campaign_mapping_id == request.campaign_mapping_id,
                Lead.id.in_(
                    select(LeadCampaign.lead_id).where(
                        LeadCampaign.campaign_mapping_id == request.campaign_mapping_id
                    )
                )
            )
        )

    # Count leads
    from sqlalchemy import func as sql_func
    count_result = await db.execute(
        select(sql_func.count()).select_from(lead_query.subquery())
    )
    total_recipients = count_result.scalar() or 0

    if total_recipients == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No leads found matching criteria with valid phone numbers"
        )

    # Create bulk send record
    bulk_send = WhatsAppBulkSend(
        user_id=current_user.id,
        dealership_id=current_user.dealership_id,
        name=request.name or f"Bulk send - {template.name}",
        message_template=request.content_sid,
        filter_criteria={
            "campaign_mapping_id": str(request.campaign_mapping_id) if request.campaign_mapping_id else None,
            "lead_ids": [str(lid) for lid in request.lead_ids] if request.lead_ids else None,
            "content_variables": request.content_variables,
        },
        total_recipients=total_recipients,
        status="pending",
    )
    db.add(bulk_send)
    await db.commit()
    await db.refresh(bulk_send)

    logger.info(
        f"Bulk WhatsApp send created: {bulk_send.id} by {current_user.email} "
        f"template={request.content_sid} recipients={total_recipients}"
    )

    # TODO: Queue background task to process the bulk send
    # For now, we just create the record - Phase 4 will add the actual sending

    return BulkSendResponse(
        id=bulk_send.id,
        status=bulk_send.status,
        total_recipients=total_recipients,
        message=f"Bulk send queued for {total_recipients} recipients",
    )


@router.get("/bulk-sends", response_model=List[BulkSendStatusResponse])
async def list_bulk_sends(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """List bulk send operations for the current user's dealership."""
    if current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view bulk sends"
        )

    query = select(WhatsAppBulkSend).order_by(WhatsAppBulkSend.created_at.desc())

    if current_user.role != UserRole.SUPER_ADMIN:
        query = query.where(WhatsAppBulkSend.dealership_id == current_user.dealership_id)

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    bulk_sends = result.scalars().all()

    return [
        BulkSendStatusResponse(
            id=bs.id,
            name=bs.name,
            status=bs.status,
            total_recipients=bs.total_recipients,
            sent_count=bs.sent_count,
            delivered_count=bs.delivered_count,
            failed_count=bs.failed_count,
            started_at=bs.started_at,
            completed_at=bs.completed_at,
            created_at=bs.created_at,
        )
        for bs in bulk_sends
    ]


@router.get("/bulk-sends/{bulk_send_id}", response_model=BulkSendStatusResponse)
async def get_bulk_send_status(
    bulk_send_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get status of a specific bulk send operation."""
    if current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view bulk sends"
        )

    result = await db.execute(
        select(WhatsAppBulkSend).where(WhatsAppBulkSend.id == bulk_send_id)
    )
    bulk_send = result.scalar_one_or_none()

    if not bulk_send:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bulk send not found")

    if current_user.role != UserRole.SUPER_ADMIN:
        if bulk_send.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return BulkSendStatusResponse(
        id=bulk_send.id,
        name=bulk_send.name,
        status=bulk_send.status,
        total_recipients=bulk_send.total_recipients,
        sent_count=bulk_send.sent_count,
        delivered_count=bulk_send.delivered_count,
        failed_count=bulk_send.failed_count,
        started_at=bulk_send.started_at,
        completed_at=bulk_send.completed_at,
        created_at=bulk_send.created_at,
    )
