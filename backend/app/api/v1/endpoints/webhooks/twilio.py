"""
Twilio Webhooks - SMS incoming and status updates
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.services.sms_conversation_service import get_sms_conversation_service
from app.services.notification_service import NotificationService
from app.core.websocket_manager import ws_manager
from app.models.lead import Lead

logger = logging.getLogger(__name__)

router = APIRouter()


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
    
    # Extract media URLs if any
    media_urls = []
    for i in range(num_media):
        media_url = form_data.get(f"MediaUrl{i}")
        if media_url:
            media_urls.append(media_url)
    
    logger.info(f"Incoming SMS webhook: {message_sid} from {from_number}")
    
    service = get_sms_conversation_service(db)
    
    # Store the message
    sms_log = await service.receive_sms(
        message_sid=message_sid,
        from_number=from_number,
        to_number=to_number,
        body=body,
        media_urls=media_urls
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
        
        # Get lead name
        from sqlalchemy import select
        result = await db.execute(
            select(Lead).where(Lead.id == sms_log.lead_id)
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
