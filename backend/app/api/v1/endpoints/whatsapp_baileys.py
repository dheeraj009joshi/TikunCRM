"""
WhatsApp Baileys API Endpoints - Admin bulk messaging via Baileys
"""
import logging
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_stage import LeadStage
from app.services.whatsapp_baileys_service import WhatsAppBaileysService as WhatsAppService

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Schemas ============

class BaileysStatusResponse(BaseModel):
    """Baileys connection status"""
    connected: bool
    status: str
    phone_number: Optional[str] = None
    qr_available: bool = False


class BaileysQRResponse(BaseModel):
    """QR code for Baileys authentication"""
    qr: Optional[str] = None
    status: str
    connected: bool = False


class SendMessageRequest(BaseModel):
    """Send single message request"""
    phone: str = Field(..., description="Phone number with country code")
    message: str = Field(..., min_length=1, max_length=4096)
    customer_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    quoted_msg_id: Optional[str] = Field(None, description="Message ID to reply to")


class SendImageRequest(BaseModel):
    """Send image message request"""
    phone: str = Field(..., description="Phone number with country code")
    image: str = Field(..., description="Base64 encoded image or URL")
    filename: Optional[str] = Field("image.jpg", description="Image filename")
    caption: Optional[str] = Field(None, max_length=4096, description="Image caption")
    customer_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None


class SendFileRequest(BaseModel):
    """Send file/document message request"""
    phone: str = Field(..., description="Phone number with country code")
    file: str = Field(..., description="Base64 encoded file or URL")
    filename: str = Field(..., description="Filename with extension")
    caption: Optional[str] = Field(None, max_length=4096, description="File caption")
    customer_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None


class SendAudioRequest(BaseModel):
    """Send audio/voice message request"""
    phone: str = Field(..., description="Phone number with country code")
    audio: str = Field(..., description="Base64 encoded audio or URL")
    is_ptt: bool = Field(True, description="Send as voice message (PTT)")
    customer_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None


class SendVideoRequest(BaseModel):
    """Send video message request"""
    phone: str = Field(..., description="Phone number with country code")
    video: str = Field(..., description="Base64 encoded video or URL")
    filename: Optional[str] = Field("video.mp4", description="Video filename")
    caption: Optional[str] = Field(None, max_length=4096, description="Video caption")
    customer_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None


class SendLocationRequest(BaseModel):
    """Send location message request"""
    phone: str = Field(..., description="Phone number with country code")
    latitude: float = Field(..., description="Location latitude")
    longitude: float = Field(..., description="Location longitude")
    title: Optional[str] = Field(None, description="Location title")
    address: Optional[str] = Field(None, description="Location address")
    customer_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None


class SendReactionRequest(BaseModel):
    """Send reaction to message request"""
    message_id: str = Field(..., description="Message ID to react to")
    emoji: str = Field(..., description="Emoji reaction")


class SendMessageResponse(BaseModel):
    """Send message response"""
    success: bool
    message_id: Optional[str] = None
    wa_message_id: Optional[str] = None
    error: Optional[str] = None


class BulkSendRequest(BaseModel):
    """Bulk send request with filters"""
    message: Optional[str] = Field(None, max_length=4096)
    lead_statuses: Optional[List[str]] = Field(None, description="Filter by lead statuses")
    dealership_id: Optional[UUID] = None
    customer_ids: Optional[List[UUID]] = Field(None, description="Specific customer IDs")
    name: Optional[str] = Field(None, description="Campaign name")
    min_delay: int = Field(5, ge=3, le=60, description="Min delay between messages (seconds)")
    max_delay: int = Field(30, ge=5, le=120, description="Max delay between messages (seconds)")
    media: Optional[str] = Field(None, description="Base64 media data")
    media_type: Optional[str] = Field(None, description="Media type: image, file, video")
    media_filename: Optional[str] = Field(None, description="Media filename")


class BulkSendResponse(BaseModel):
    """Bulk send response"""
    success: bool
    bulk_send_id: Optional[str] = None
    total: int = 0
    sent: int = 0
    failed: int = 0
    error: Optional[str] = None


class MarkAsReadRequest(BaseModel):
    """Mark messages as read request"""
    phone: str = Field(..., description="Phone number of the conversation")
    message_ids: Optional[List[str]] = Field(None, description="List of message IDs to mark as read")


class MarkAsReadResponse(BaseModel):
    """Mark as read response"""
    success: bool
    count: int = 0
    error: Optional[str] = None


class ConversationItem(BaseModel):
    """Conversation list item"""
    phone_number: str
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    lead_id: Optional[str] = None
    lead_name: Optional[str] = None
    last_message: Optional[str] = None
    last_message_at: Optional[str] = None
    direction: str
    last_message_status: Optional[str] = None
    unread_count: int = 0


class ConversationsResponse(BaseModel):
    """Conversations list response"""
    items: List[ConversationItem]
    total: int


class MessageItem(BaseModel):
    """Single message"""
    id: str
    wa_message_id: Optional[str] = None
    direction: str
    body: Optional[str] = None
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    status: str
    sent_at: Optional[str] = None
    received_at: Optional[str] = None
    created_at: Optional[str] = None
    is_read: bool = False


class MessagesResponse(BaseModel):
    """Messages for a conversation"""
    phone_number: str
    customer_name: Optional[str] = None
    messages: List[MessageItem]


class BulkSendHistoryItem(BaseModel):
    """Bulk send history item"""
    id: str
    name: Optional[str] = None
    message_template: str
    total_recipients: int
    sent_count: int
    delivered_count: int
    failed_count: int
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: Optional[str] = None


class BulkSendHistoryResponse(BaseModel):
    """Bulk send history"""
    items: List[BulkSendHistoryItem]


class CheckNumberRequest(BaseModel):
    """Check if number is on WhatsApp"""
    phone: str


class CheckNumberResponse(BaseModel):
    """Check number response"""
    phone: str
    exists: bool
    jid: Optional[str] = None


class RecipientPreviewItem(BaseModel):
    """Recipient preview for bulk send"""
    customer_id: str
    customer_name: str
    phone: str
    lead_id: Optional[str] = None
    lead_status: Optional[str] = None


class RecipientPreviewResponse(BaseModel):
    """Preview of recipients for bulk send"""
    recipients: List[RecipientPreviewItem]
    total: int


# ============ Helper Functions ============

def require_admin(current_user: User):
    """Require admin role for WhatsApp Baileys features"""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for WhatsApp messaging"
        )


# ============ Endpoints ============

@router.get("/status", response_model=BaileysStatusResponse)
async def get_baileys_status(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get WhatsApp Baileys connection status"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.get_status()
    
    # Node.js returns: { connected, state, hasQr }
    # Map to our response format
    is_connected = result.get("connected", False)
    state = result.get("state", "unknown")
    has_qr = result.get("hasQr", False)
    
    return BaileysStatusResponse(
        connected=is_connected,
        status=state,
        phone_number=result.get("phoneNumber"),
        qr_available=has_qr,
    )


@router.get("/qr", response_model=BaileysQRResponse)
async def get_baileys_qr(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get QR code for WhatsApp authentication"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.get_qr_code()
    
    # Node.js /qr/base64 returns: { success, connected, qrImage } or { success, connected, message }
    # Python service extracts base64 into "qr" field
    is_connected = result.get("connected", False)
    qr_code = result.get("qr")  # Set by Python service from qrImage
    
    return BaileysQRResponse(
        qr=qr_code,
        status="connected" if is_connected else ("qr" if qr_code else "waiting"),
        connected=is_connected,
    )


@router.post("/disconnect")
async def disconnect_baileys(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Disconnect WhatsApp session"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.disconnect()
    
    return {"success": result.get("success", False), "message": result.get("message")}


@router.post("/reconnect")
async def reconnect_baileys(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Reconnect WhatsApp session"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.reconnect()
    
    return {"success": result.get("success", False), "message": result.get("message")}


@router.post("/check-number", response_model=CheckNumberResponse)
async def check_whatsapp_number(
    request: CheckNumberRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if a phone number is registered on WhatsApp"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.check_number(request.phone)
    
    return CheckNumberResponse(
        phone=request.phone,
        exists=result.get("exists", False),
        jid=result.get("jid"),
    )


@router.post("/send", response_model=SendMessageResponse)
async def send_whatsapp_message(
    request: SendMessageRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a single WhatsApp text message"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_message(
        phone=request.phone,
        message=request.message,
        user_id=current_user.id,
        customer_id=request.customer_id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id,
        quoted_msg_id=request.quoted_msg_id,
    )
    
    await db.commit()
    
    return SendMessageResponse(
        success=result.get("success", False),
        message_id=result.get("message_id"),
        wa_message_id=result.get("wa_message_id"),
        error=result.get("error"),
    )


@router.post("/send/image", response_model=SendMessageResponse)
async def send_whatsapp_image(
    request: SendImageRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send an image message via WhatsApp"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_image(
        phone=request.phone,
        image=request.image,
        filename=request.filename,
        caption=request.caption,
        user_id=current_user.id,
        customer_id=request.customer_id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id,
    )
    
    await db.commit()
    
    return SendMessageResponse(
        success=result.get("success", False),
        message_id=result.get("message_id"),
        wa_message_id=result.get("wa_message_id"),
        error=result.get("error"),
    )


@router.post("/send/file", response_model=SendMessageResponse)
async def send_whatsapp_file(
    request: SendFileRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a file/document via WhatsApp"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_file(
        phone=request.phone,
        file=request.file,
        filename=request.filename,
        caption=request.caption,
        user_id=current_user.id,
        customer_id=request.customer_id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id,
    )
    
    await db.commit()
    
    return SendMessageResponse(
        success=result.get("success", False),
        message_id=result.get("message_id"),
        wa_message_id=result.get("wa_message_id"),
        error=result.get("error"),
    )


@router.post("/send/audio", response_model=SendMessageResponse)
async def send_whatsapp_audio(
    request: SendAudioRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send an audio/voice message via WhatsApp"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_audio(
        phone=request.phone,
        audio=request.audio,
        is_ptt=request.is_ptt,
        user_id=current_user.id,
        customer_id=request.customer_id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id,
    )
    
    await db.commit()
    
    return SendMessageResponse(
        success=result.get("success", False),
        message_id=result.get("message_id"),
        wa_message_id=result.get("wa_message_id"),
        error=result.get("error"),
    )


@router.post("/send/video", response_model=SendMessageResponse)
async def send_whatsapp_video(
    request: SendVideoRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a video message via WhatsApp"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_video(
        phone=request.phone,
        video=request.video,
        filename=request.filename,
        caption=request.caption,
        user_id=current_user.id,
        customer_id=request.customer_id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id,
    )
    
    await db.commit()
    
    return SendMessageResponse(
        success=result.get("success", False),
        message_id=result.get("message_id"),
        wa_message_id=result.get("wa_message_id"),
        error=result.get("error"),
    )


@router.post("/send/location", response_model=SendMessageResponse)
async def send_whatsapp_location(
    request: SendLocationRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a location message via WhatsApp"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_location(
        phone=request.phone,
        latitude=request.latitude,
        longitude=request.longitude,
        title=request.title,
        address=request.address,
        user_id=current_user.id,
        customer_id=request.customer_id,
        lead_id=request.lead_id,
        dealership_id=current_user.dealership_id,
    )
    
    await db.commit()
    
    return SendMessageResponse(
        success=result.get("success", False),
        message_id=result.get("message_id"),
        wa_message_id=result.get("wa_message_id"),
        error=result.get("error"),
    )


@router.post("/send/reaction", response_model=SendMessageResponse)
async def send_whatsapp_reaction(
    request: SendReactionRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a reaction to a message"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.send_reaction(
        message_id=request.message_id,
        emoji=request.emoji,
    )
    
    return SendMessageResponse(
        success=result.get("success", False),
        wa_message_id=request.message_id,
        error=result.get("error"),
    )


@router.post("/bulk-send/preview", response_model=RecipientPreviewResponse)
async def preview_bulk_send_recipients(
    request: BulkSendRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview recipients for bulk send based on filters"""
    require_admin(current_user)
    
    # Build query for recipients
    query = (
        select(Customer, Lead)
        .join(Lead, Lead.customer_id == Customer.id)
        .where(
            and_(
                Customer.phone.isnot(None),
                Customer.phone != "",
            )
        )
    )
    
    # Filter by dealership
    dealership_id = request.dealership_id or current_user.dealership_id
    if dealership_id:
        query = query.where(Lead.dealership_id == dealership_id)
    
    # Filter by lead stages (by name)
    if request.lead_statuses:
        # Join with LeadStage and filter by name
        query = query.join(LeadStage, Lead.stage_id == LeadStage.id)
        query = query.where(LeadStage.name.in_(request.lead_statuses))
    
    # Filter by specific customer IDs
    if request.customer_ids:
        query = query.where(Customer.id.in_(request.customer_ids))
    
    # Get distinct customers
    query = query.distinct(Customer.id).limit(500)
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get stage names for display
    stage_map = {}
    if rows:
        stage_ids = list(set(r[1].stage_id for r in rows if r[1]))
        if stage_ids:
            stage_result = await db.execute(select(LeadStage).where(LeadStage.id.in_(stage_ids)))
            for stage in stage_result.scalars().all():
                stage_map[stage.id] = stage.name
    
    recipients = []
    seen_customers = set()
    for customer, lead in rows:
        if customer.id in seen_customers:
            continue
        seen_customers.add(customer.id)
        recipients.append(RecipientPreviewItem(
            customer_id=str(customer.id),
            customer_name=customer.full_name or f"{customer.first_name} {customer.last_name}".strip(),
            phone=customer.phone,
            lead_id=str(lead.id) if lead else None,
            lead_status=stage_map.get(lead.stage_id) if lead else None,
        ))
    
    return RecipientPreviewResponse(
        recipients=recipients,
        total=len(recipients),
    )


@router.post("/bulk-send", response_model=BulkSendResponse)
async def send_bulk_whatsapp(
    request: BulkSendRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Send bulk WhatsApp messages via Baileys"""
    require_admin(current_user)
    
    # Build query for recipients (same as preview)
    query = (
        select(Customer, Lead)
        .join(Lead, Lead.customer_id == Customer.id)
        .where(
            and_(
                Customer.phone.isnot(None),
                Customer.phone != "",
            )
        )
    )
    
    dealership_id = request.dealership_id or current_user.dealership_id
    if dealership_id:
        query = query.where(Lead.dealership_id == dealership_id)
    
    if request.lead_statuses:
        query = query.join(LeadStage, Lead.stage_id == LeadStage.id)
        query = query.where(LeadStage.name.in_(request.lead_statuses))
    
    if request.customer_ids:
        query = query.where(Customer.id.in_(request.customer_ids))
    
    query = query.distinct(Customer.id).limit(100)  # Limit for safety
    
    result = await db.execute(query)
    rows = result.all()
    
    # Build recipients list
    recipients = []
    seen_customers = set()
    for customer, lead in rows:
        if customer.id in seen_customers:
            continue
        seen_customers.add(customer.id)
        recipients.append({
            "phone": customer.phone,
            "customer_id": customer.id,
            "lead_id": lead.id if lead else None,
        })
    
    if not recipients:
        return BulkSendResponse(
            success=False,
            error="No recipients found matching the criteria",
            total=0,
        )
    
    # Validate that either message or media is provided
    if not request.message and not request.media:
        return BulkSendResponse(
            success=False,
            error="Either message or media is required",
            total=0,
        )
    
    # Send via service
    service = WhatsAppService(db)
    result = await service.send_bulk_messages(
        recipients=recipients,
        message=request.message or "",
        user_id=current_user.id,
        dealership_id=dealership_id,
        name=request.name,
        filter_criteria={
            "lead_statuses": request.lead_statuses,
            "customer_ids": [str(c) for c in (request.customer_ids or [])],
        },
        min_delay=request.min_delay,
        max_delay=request.max_delay,
        media=request.media,
        media_type=request.media_type,
        media_filename=request.media_filename,
    )
    
    await db.commit()
    
    return BulkSendResponse(
        success=result.get("success", False),
        bulk_send_id=result.get("bulk_send_id"),
        total=result.get("total", 0),
        sent=result.get("sent", 0),
        failed=result.get("failed", 0),
        error=result.get("error"),
    )


@router.get("/conversations", response_model=ConversationsResponse)
async def get_conversations(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get list of WhatsApp conversations"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    conversations = await service.get_conversations(
        dealership_id=current_user.dealership_id,
        limit=limit,
        offset=offset,
    )
    
    return ConversationsResponse(
        items=[ConversationItem(**c) for c in conversations],
        total=len(conversations),
    )


@router.get("/conversations/{phone_number}", response_model=MessagesResponse)
async def get_conversation_messages(
    phone_number: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get messages for a specific phone number"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    messages = await service.get_messages(
        phone_number=phone_number,
        limit=limit,
        offset=offset,
        mark_as_read=True,
    )
    
    await db.commit()
    
    # Try to get customer name
    customer_name = None
    normalized_phone = "".join(filter(str.isdigit, phone_number))
    customer_query = select(Customer).where(
        or_(
            Customer.phone == phone_number,
            Customer.phone == normalized_phone,
        )
    ).limit(1)
    customer_result = await db.execute(customer_query)
    customer = customer_result.scalar_one_or_none()
    if customer:
        customer_name = customer.full_name or f"{customer.first_name} {customer.last_name}".strip()
    
    return MessagesResponse(
        phone_number=phone_number,
        customer_name=customer_name,
        messages=[MessageItem(**m) for m in messages],
    )


@router.post("/messages/read", response_model=MarkAsReadResponse)
async def mark_messages_as_read(
    request: MarkAsReadRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark messages as read in WhatsApp (sends read receipts)"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    result = await service.mark_messages_as_read(
        phone=request.phone,
        message_ids=request.message_ids,
    )
    
    return MarkAsReadResponse(**result)


@router.get("/bulk-sends", response_model=BulkSendHistoryResponse)
async def get_bulk_send_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get bulk send history"""
    require_admin(current_user)
    
    service = WhatsAppService(db)
    bulk_sends = await service.get_bulk_sends(
        dealership_id=current_user.dealership_id,
        limit=limit,
        offset=offset,
    )
    
    return BulkSendHistoryResponse(
        items=[BulkSendHistoryItem(**bs) for bs in bulk_sends],
    )


@router.post("/webhook/incoming")
async def handle_incoming_message(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Webhook endpoint for incoming WhatsApp messages from Baileys service.
    Called by the Node.js service when a message is received.
    Only stores messages from known phone numbers (not @lid internal IDs).
    """
    logger.info(f"Received incoming WhatsApp message: {payload}")
    
    raw_from = payload.get("from", "")
    
    # Skip @lid messages - these are internal WhatsApp IDs without real phone numbers
    # @lid format is used by WhatsApp Business linked devices and doesn't expose actual phone
    if "@lid" in raw_from or not any(c.isdigit() for c in raw_from):
        logger.info(f"Skipping @lid message from {raw_from} - cannot determine real phone number")
        return {"success": False, "error": "Cannot process @lid messages - no real phone number"}
    
    # Handle various phone formats: @s.whatsapp.net, @g.us
    phone = raw_from.replace("@s.whatsapp.net", "").replace("@g.us", "")
    # Extract just digits
    if ":" in phone:
        phone = phone.split(":")[0]
    
    # Normalize to digits only
    phone = "".join(filter(str.isdigit, phone))
    
    body = payload.get("body", "")
    wa_message_id = payload.get("id")
    media_url = payload.get("mediaUrl")
    media_type = payload.get("mediaType")
    
    if not phone or len(phone) < 10:
        return {"success": False, "error": "Invalid phone number"}
    
    service = WhatsAppService(db)
    message = await service.store_incoming_message(
        phone=phone,
        body=body,
        wa_message_id=wa_message_id,
        media_url=media_url,
        media_type=media_type,
        meta_data=payload,
    )
    
    await db.commit()
    
    return {
        "success": True,
        "message_id": str(message.id),
        "customer_id": str(message.customer_id) if message.customer_id else None,
    }


@router.post("/cleanup")
async def cleanup_and_normalize_messages(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Clean up and normalize WhatsApp messages:
    1. Delete messages with invalid phone numbers (less than 10 digits)
    2. Normalize all phone numbers to digits only (removes +, spaces, dashes)
    3. Merge duplicate conversations by consolidating messages with same last 10 digits
    
    Only available to admins.
    """
    require_admin(current_user)
    
    from app.models.whatsapp_message import WhatsAppMessage
    from sqlalchemy import delete, func, update, text
    
    # Step 1: Delete messages where phone_number doesn't look like a valid phone number
    delete_query = delete(WhatsAppMessage).where(
        func.length(func.regexp_replace(WhatsAppMessage.phone_number, '[^0-9]', '', 'g')) < 10
    )
    delete_result = await db.execute(delete_query)
    deleted_count = delete_result.rowcount
    
    # Step 2: Normalize all phone numbers to digits only
    # This consolidates "+14709099027" and "14709099027" into "14709099027"
    normalize_query = text("""
        UPDATE whatsapp_messages 
        SET phone_number = REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g'),
            from_number = REGEXP_REPLACE(COALESCE(from_number, ''), '[^0-9]', '', 'g'),
            to_number = REGEXP_REPLACE(COALESCE(to_number, ''), '[^0-9]', '', 'g')
        WHERE phone_number ~ '[^0-9]'
           OR from_number ~ '[^0-9]'
           OR to_number ~ '[^0-9]'
    """)
    normalize_result = await db.execute(normalize_query)
    normalized_count = normalize_result.rowcount
    
    # Step 3: Merge duplicates - standardize all phone numbers to last 10 digits
    # This consolidates "114709099027" and "14709099027" into "4709099027" (last 10)
    # For each unique suffix, pick the canonical phone (the shortest normalized one)
    merge_query = text("""
        WITH phone_suffixes AS (
            SELECT DISTINCT 
                phone_number,
                RIGHT(phone_number, 10) as suffix
            FROM whatsapp_messages
            WHERE LENGTH(phone_number) >= 10
        ),
        canonical_phones AS (
            SELECT DISTINCT ON (suffix)
                suffix,
                phone_number as canonical_phone
            FROM phone_suffixes
            ORDER BY suffix, LENGTH(phone_number) ASC
        )
        UPDATE whatsapp_messages m
        SET phone_number = c.canonical_phone
        FROM canonical_phones c
        WHERE RIGHT(m.phone_number, 10) = c.suffix
          AND m.phone_number != c.canonical_phone
    """)
    merge_result = await db.execute(merge_query)
    merged_count = merge_result.rowcount
    
    await db.commit()
    
    logger.info(f"Cleanup: deleted {deleted_count} invalid, normalized {normalized_count}, merged {merged_count} messages")
    
    return {
        "success": True,
        "deleted_count": deleted_count,
        "normalized_count": normalized_count,
        "merged_count": merged_count,
        "message": f"Deleted {deleted_count} invalid messages, normalized {normalized_count}, merged {merged_count} duplicate phone numbers",
    }


@router.delete("/messages/all")
async def delete_all_messages(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete all WhatsApp messages. Only available to admins.
    Use with caution - this permanently removes all conversation history.
    """
    require_admin(current_user)
    
    from app.models.whatsapp_message import WhatsAppMessage, WhatsAppChannel
    from sqlalchemy import delete
    
    delete_query = delete(WhatsAppMessage).where(
        WhatsAppMessage.channel == WhatsAppChannel.BAILEYS
    )
    result = await db.execute(delete_query)
    deleted_count = result.rowcount
    
    await db.commit()
    
    logger.info(f"Deleted all {deleted_count} WhatsApp messages")
    
    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"Deleted {deleted_count} WhatsApp messages",
    }


@router.post("/webhook/status")
async def handle_status_update(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Webhook endpoint for message status updates from Baileys service.
    Called by the Node.js service when a message status changes (sent, delivered, read).
    """
    logger.info(f"Received status update: {payload}")
    
    message_id = payload.get("messageId")
    status = payload.get("status")
    
    if not message_id or not status:
        return {"success": False, "error": "Missing messageId or status"}
    
    service = WhatsAppService(db)
    updated = await service.update_message_status(
        wa_message_id=message_id,
        status=status,
    )
    
    await db.commit()
    
    return {
        "success": updated,
        "message_id": message_id,
        "status": status,
    }
