"""
Twilio Webhooks - SMS and WhatsApp incoming and status updates
"""
import logging
from typing import Optional, List, Tuple
from uuid import UUID
import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.services.sms_conversation_service import get_sms_conversation_service
from app.services.whatsapp_conversation_service import get_whatsapp_conversation_service
from app.services.dealership_twilio_config_service import (
    find_dealership_id_by_inbound_to,
)
from app.services.notification_service import NotificationService
from app.core.websocket_manager import ws_manager
from app.core.config import settings
from app.models.lead import Lead

logger = logging.getLogger(__name__)

router = APIRouter()


async def transfer_twilio_media_to_azure(
    twilio_urls: List[str],
    content_types: List[str],
    dealership_id: Optional[UUID] = None,
) -> Tuple[List[str], List[str]]:
    """
    Download media from Twilio URLs and upload to Azure Blob storage.
    Returns tuple of (azure_urls, content_types).
    """
    from app.services.azure_storage_service import azure_storage_service
    
    if not azure_storage_service.is_whatsapp_media_configured:
        logger.warning("Azure WhatsApp media storage not configured, keeping Twilio URLs")
        return twilio_urls, content_types
    
    azure_urls = []
    final_content_types = []
    
    # Get Twilio credentials for authenticated media fetch
    account_sid = settings.twilio_account_sid
    auth_token = settings.twilio_auth_token
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        for i, twilio_url in enumerate(twilio_urls):
            content_type = content_types[i] if i < len(content_types) else "application/octet-stream"
            
            try:
                # Twilio media URLs require authentication
                response = await client.get(
                    twilio_url,
                    auth=(account_sid, auth_token) if account_sid and auth_token else None,
                    follow_redirects=True,
                )
                
                if response.status_code != 200:
                    logger.error(f"Failed to download Twilio media: {response.status_code}")
                    azure_urls.append(twilio_url)  # Keep original URL as fallback
                    final_content_types.append(content_type)
                    continue
                
                media_data = response.content
                
                # Determine filename from content type
                ext_map = {
                    "image/jpeg": "jpg",
                    "image/png": "png",
                    "image/gif": "gif",
                    "image/webp": "webp",
                    "video/mp4": "mp4",
                    "video/3gpp": "3gp",
                    "audio/ogg": "ogg",
                    "audio/mpeg": "mp3",
                    "audio/amr": "amr",
                    "audio/aac": "aac",
                    "application/pdf": "pdf",
                }
                ext = ext_map.get(content_type, content_type.split("/")[-1] if "/" in content_type else "bin")
                filename = f"incoming_media.{ext}"
                
                # Upload to Azure
                azure_url = await azure_storage_service.upload_whatsapp_media(
                    data=media_data,
                    filename=filename,
                    content_type=content_type,
                    dealership_id=dealership_id,
                )
                
                if azure_url:
                    azure_urls.append(azure_url)
                    final_content_types.append(content_type)
                    logger.info(f"Transferred Twilio media to Azure: {azure_url}")
                else:
                    logger.error("Azure upload returned None, keeping Twilio URL")
                    azure_urls.append(twilio_url)
                    final_content_types.append(content_type)
                    
            except Exception as e:
                logger.error(f"Error transferring media from Twilio to Azure: {e}")
                azure_urls.append(twilio_url)  # Keep original URL as fallback
                final_content_types.append(content_type)
    
    return azure_urls, final_content_types


def _normalize_whatsapp_number(raw: str) -> str:
    """Strip whatsapp: prefix for storage/lookup."""
    if raw.startswith("whatsapp:"):
        return raw[9:].strip()
    return raw.strip()


@router.post("/sms/incoming", response_class=PlainTextResponse)
async def handle_incoming_sms(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for incoming SMS messages.
    Stores the message and notifies the assigned user.
    """
    form_data = await request.form()
    
    message_sid = form_data.get("MessageSid", "")
    from_number = form_data.get("From", "")
    to_number = form_data.get("To", "")
    body = form_data.get("Body", "")
    num_media = int(form_data.get("NumMedia", "0"))
    
    # Extract media URLs and content types
    twilio_media_urls = []
    twilio_content_types = []
    for i in range(num_media):
        media_url = form_data.get(f"MediaUrl{i}")
        content_type = form_data.get(f"MediaContentType{i}") or "application/octet-stream"
        if media_url:
            twilio_media_urls.append(media_url)
            twilio_content_types.append(content_type)
    
    logger.info(f"Incoming SMS webhook: {message_sid} from {from_number}")

    resolved_dealership_id = await find_dealership_id_by_inbound_to(db, to_number)

    # Transfer media from Twilio to Azure Blob storage
    media_urls = twilio_media_urls
    if twilio_media_urls:
        try:
            media_urls, _ = await transfer_twilio_media_to_azure(
                twilio_media_urls,
                twilio_content_types,
                dealership_id=resolved_dealership_id,
            )
            logger.info(f"SMS: Transferred {len(media_urls)} media files to Azure")
        except Exception as e:
            logger.error(f"SMS: Failed to transfer media to Azure, using Twilio URLs: {e}")
            media_urls = twilio_media_urls

    service = get_sms_conversation_service(db)

    sms_log = await service.receive_sms(
        message_sid=message_sid,
        from_number=from_number,
        to_number=to_number,
        body=body,
        media_urls=media_urls,
        resolved_dealership_id=resolved_dealership_id,
    )
    
    await db.commit()
    
    # Send real-time notification
    if sms_log.lead_id and sms_log.user_id:
        # Notify the assigned user via WebSocket
        await ws_manager.send_to_user(
            str(sms_log.user_id),
            {
                "type": "sms:received",
                "payload": {
                    "message_id": str(sms_log.id),
                    "lead_id": str(sms_log.lead_id),
                    "from_number": from_number,
                    "body_preview": body[:100] if body else "",
                    "has_media": len(media_urls) > 0
                }
            }
        )
        
        # Create a notification
        notification_service = NotificationService(db)
        
        # Get lead name (eager-load customer for first_name/last_name)
        result = await db.execute(
            select(Lead).options(selectinload(Lead.customer)).where(Lead.id == sms_log.lead_id)
        )
        lead = result.scalar_one_or_none()
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() if lead else "Unknown"
        
        await notification_service.create_notification(
            user_id=sms_log.user_id,
            title="New SMS Received",
            message=f"Message from {lead_name}: {body[:50]}..." if len(body) > 50 else f"Message from {lead_name}: {body}",
            link=f"/leads/{sms_log.lead_id}?tab=sms",
            notification_type="sms_received",
            meta_data={
                "lead_id": str(sms_log.lead_id),
                "message_id": str(sms_log.id),
                "from_number": from_number
            },
            send_push=True,
            send_email=False,  # Don't email for SMS
            send_sms=False     # Don't SMS about SMS
        )
        
        await db.commit()
    
    # Return empty TwiML response (no auto-reply)
    return Response(
        content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        media_type="application/xml"
    )


@router.post("/sms/status")
async def handle_sms_status(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for SMS delivery status updates.
    Updates the message status in the database.
    """
    form_data = await request.form()
    
    message_sid = form_data.get("MessageSid", "")
    message_status = form_data.get("MessageStatus", "")
    error_code = form_data.get("ErrorCode")
    error_message = form_data.get("ErrorMessage")
    
    logger.info(f"SMS status webhook: {message_sid} -> {message_status}")
    
    service = get_sms_conversation_service(db)
    
    sms_log = await service.update_delivery_status(
        message_sid=message_sid,
        status=message_status,
        error_code=error_code,
        error_message=error_message
    )
    
    if sms_log:
        # Send real-time status update
        if sms_log.lead_id:
            await ws_manager.broadcast_to_dealership(
                str(sms_log.dealership_id) if sms_log.dealership_id else None,
                {
                    "type": "sms:status",
                    "payload": {
                        "message_id": str(sms_log.id),
                        "lead_id": str(sms_log.lead_id),
                        "status": message_status
                    }
                }
            )
    
    await db.commit()
    
    return {"status": "ok"}


@router.post("/whatsapp/incoming", response_class=PlainTextResponse)
async def handle_incoming_whatsapp(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Twilio webhook for incoming WhatsApp messages."""
    form_data = await request.form()
    # MessageSid is standard; SmsSid appears on some Twilio channels / retries.
    message_sid = (form_data.get("MessageSid") or form_data.get("SmsSid") or "").strip()
    from_raw = form_data.get("From") or ""
    to_raw = form_data.get("To") or ""
    body = str(form_data.get("Body") or "")
    raw_num_media = form_data.get("NumMedia")
    try:
        num_media = int(raw_num_media) if raw_num_media not in (None, "") else 0
    except (TypeError, ValueError):
        num_media = 0
    from_number = _normalize_whatsapp_number(from_raw) or (str(from_raw).replace("whatsapp:", "")[:32])
    to_number = _normalize_whatsapp_number(to_raw) or (str(to_raw).replace("whatsapp:", "")[:32])

    twilio_media_urls = []
    twilio_content_types = []
    for i in range(max(0, num_media)):
        url = form_data.get(f"MediaUrl{i}")
        content_type = form_data.get(f"MediaContentType{i}") or ""
        if url:
            twilio_media_urls.append(url)
            twilio_content_types.append(content_type)

    logger.info(
        "Incoming WhatsApp webhook: sid=%s from=%s to=%s body_len=%s media_count=%s",
        message_sid or "(empty)",
        from_number,
        to_number,
        len(body),
        len(twilio_media_urls),
    )
    resolved_dealership_id = await find_dealership_id_by_inbound_to(db, to_raw)

    # Transfer media from Twilio to Azure Blob storage
    media_urls = twilio_media_urls
    media_content_types = twilio_content_types
    if twilio_media_urls:
        try:
            media_urls, media_content_types = await transfer_twilio_media_to_azure(
                twilio_media_urls,
                twilio_content_types,
                dealership_id=resolved_dealership_id,
            )
            logger.info(f"Transferred {len(media_urls)} media files to Azure")
        except Exception as e:
            logger.error(f"Failed to transfer media to Azure, using Twilio URLs: {e}")
            media_urls = twilio_media_urls
            media_content_types = twilio_content_types

    service = get_whatsapp_conversation_service(db)
    wa_log = await service.receive_whatsapp(
        message_sid=message_sid,
        from_number=from_number,
        to_number=to_number,
        body=body,
        media_urls=media_urls,
        media_content_types=media_content_types,
        resolved_dealership_id=resolved_dealership_id,
    )
    await db.commit()
    logger.info("Incoming WhatsApp stored: id=%s direction=inbound sid=%s", wa_log.id, wa_log.twilio_message_sid)

    if wa_log.lead_id and wa_log.dealership_id:
        try:
            # Include full message for instant local updates on frontend
            await ws_manager.broadcast_to_dealership(
                str(wa_log.dealership_id),
                {
                    "type": "whatsapp:received",
                    "payload": {
                        "message_id": str(wa_log.id),
                        "lead_id": str(wa_log.lead_id),
                        "from_number": from_number,
                        "body_preview": body[:100] if body else "",
                        "has_media": len(media_urls) > 0,
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
                    },
                },
            )
        except Exception as e:
            logger.warning("whatsapp:received broadcast failed: %s", e, exc_info=True)

    if wa_log.lead_id and wa_log.user_id:
        try:
            notification_service = NotificationService(db)
            result = await db.execute(
                select(Lead).options(selectinload(Lead.customer)).where(Lead.id == wa_log.lead_id)
            )
            lead = result.scalar_one_or_none()
            lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() if lead else "Unknown"
            await notification_service.create_notification(
                user_id=wa_log.user_id,
                title="New WhatsApp",
                message=f"Message from {lead_name}: {body[:50]}..." if len(body) > 50 else f"Message from {lead_name}: {body}",
                link=f"/leads/{wa_log.lead_id}?tab=whatsapp",
                notification_type="whatsapp_received",
                meta_data={
                    "lead_id": str(wa_log.lead_id),
                    "message_id": str(wa_log.id),
                    "from_number": from_number
                },
                send_push=True,
                send_email=False,
                send_sms=False
            )
            await db.commit()
        except Exception as e:
            logger.warning("WhatsApp incoming notification failed (message already stored): %s", e, exc_info=True)

    return Response(
        content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        media_type="application/xml"
    )


@router.post("/whatsapp/status")
async def handle_whatsapp_status(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for WhatsApp message delivery status updates.
    Updates the message status in the database and broadcasts to the frontend.
    """
    form_data = await request.form()
    message_sid = form_data.get("MessageSid", "")
    message_status = form_data.get("MessageStatus", "")
    error_code = form_data.get("ErrorCode")
    error_message = form_data.get("ErrorMessage")

    logger.info(f"WhatsApp status webhook: {message_sid} -> {message_status}")

    service = get_whatsapp_conversation_service(db)
    wa_log = await service.update_delivery_status(
        message_sid=message_sid,
        status=message_status,
        error_code=error_code,
        error_message=error_message,
    )

    if wa_log and wa_log.lead_id and wa_log.dealership_id:
        try:
            await ws_manager.broadcast_to_dealership(
                str(wa_log.dealership_id),
                {
                    "type": "whatsapp:status",
                    "payload": {
                        "message_id": str(wa_log.id),
                        "lead_id": str(wa_log.lead_id),
                        "status": message_status,
                        "delivered_at": wa_log.delivered_at.isoformat() if wa_log.delivered_at else None,
                        "read_at": wa_log.read_at.isoformat() if hasattr(wa_log, "read_at") and wa_log.read_at else None,
                    },
                },
            )
        except Exception as e:
            logger.warning("whatsapp:status broadcast failed: %s", e, exc_info=True)

    await db.commit()
    return {"status": "ok"}
