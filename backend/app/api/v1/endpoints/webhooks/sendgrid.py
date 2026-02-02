"""
SendGrid Webhook Endpoints

Handles:
1. Inbound Parse - Receives incoming emails when customers reply
2. Event Webhook - Receives delivery status updates (delivered, opened, clicked, bounced)
"""
import hashlib
import hmac
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Form, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.config import settings
from app.models.email_log import EmailLog, EmailDirection, EmailDeliveryStatus
from app.models.user import User
from app.models.lead import Lead
from app.models.dealership import Dealership
from app.models.notification import Notification

logger = logging.getLogger(__name__)

router = APIRouter()


def verify_sendgrid_signature(payload: bytes, signature: str, timestamp: str) -> bool:
    """
    Verify SendGrid webhook signature for security.
    
    SendGrid signs webhooks using HMAC SHA256.
    """
    if not settings.sendgrid_webhook_key:
        # If no key configured, skip verification (development mode)
        logger.warning("SendGrid webhook key not configured - skipping signature verification")
        return True
    
    try:
        # Combine timestamp and payload
        signed_payload = f"{timestamp}{payload.decode('utf-8')}"
        
        # Calculate expected signature
        expected_signature = hmac.new(
            settings.sendgrid_webhook_key.encode('utf-8'),
            signed_payload.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected_signature)
    except Exception as e:
        logger.error(f"Signature verification failed: {e}")
        return False


def parse_email_address(email_string: str) -> tuple[str, Optional[str]]:
    """
    Parse email address from format: "Name <email@example.com>" or "email@example.com"
    
    Returns: (email, name)
    """
    if not email_string:
        return ("", None)
    
    # Try to match "Name <email>" format
    match = re.match(r'^(.+?)\s*<(.+?)>$', email_string.strip())
    if match:
        return (match.group(2).strip(), match.group(1).strip())
    
    # Plain email
    return (email_string.strip(), None)


async def find_user_from_inbound_address(
    to_email: str, 
    db: AsyncSession
) -> tuple[Optional[User], Optional[Dealership]]:
    """
    Parse the inbound address to find the user and dealership.
    
    Format: {user_id_prefix}@{dealership_slug}.{inbound_domain}
    Example: a1b2c3d4@motors.inbound.leedscrm.com
    """
    try:
        email_lower = to_email.lower()
        
        # Extract local part and domain
        local_part, domain = email_lower.split('@', 1)
        
        # The user_id prefix is in the local part
        user_id_prefix = local_part
        
        # The dealership slug is the first part of the domain
        domain_parts = domain.split('.')
        if len(domain_parts) >= 1:
            dealership_slug = domain_parts[0]
        else:
            dealership_slug = None
        
        # Find user by ID prefix
        result = await db.execute(
            select(User).where(
                User.id.cast(str).startswith(user_id_prefix)
            ).limit(1)
        )
        user = result.scalar_one_or_none()
        
        # Find dealership by slug if we have one
        dealership = None
        if dealership_slug and user and user.dealership_id:
            result = await db.execute(
                select(Dealership).where(Dealership.id == user.dealership_id)
            )
            dealership = result.scalar_one_or_none()
        
        return (user, dealership)
        
    except Exception as e:
        logger.error(f"Failed to parse inbound address {to_email}: {e}")
        return (None, None)


async def find_lead_from_email(
    email: str,
    dealership_id: Optional[uuid.UUID],
    db: AsyncSession
) -> Optional[Lead]:
    """Find a lead by their email address."""
    try:
        query = select(Lead).where(Lead.email == email.lower())
        if dealership_id:
            query = query.where(Lead.dealership_id == dealership_id)
        
        result = await db.execute(query.limit(1))
        return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"Failed to find lead by email {email}: {e}")
        return None


async def find_lead_from_thread(
    in_reply_to: Optional[str],
    references: Optional[str],
    db: AsyncSession
) -> tuple[Optional[Lead], Optional[User]]:
    """
    Find lead and user from email threading headers.
    
    Looks up previous emails by message_id to find the conversation.
    """
    try:
        message_ids = []
        
        if in_reply_to:
            message_ids.append(in_reply_to.strip('<>'))
        
        if references:
            # References can contain multiple message IDs
            for ref in references.split():
                message_ids.append(ref.strip('<>'))
        
        if not message_ids:
            return (None, None)
        
        # Find original email by message_id
        result = await db.execute(
            select(EmailLog).where(
                EmailLog.message_id.in_(message_ids)
            ).order_by(EmailLog.created_at.desc()).limit(1)
        )
        original_email = result.scalar_one_or_none()
        
        if not original_email:
            return (None, None)
        
        lead = None
        user = None
        
        if original_email.lead_id:
            result = await db.execute(
                select(Lead).where(Lead.id == original_email.lead_id)
            )
            lead = result.scalar_one_or_none()
        
        if original_email.user_id:
            result = await db.execute(
                select(User).where(User.id == original_email.user_id)
            )
            user = result.scalar_one_or_none()
        
        return (lead, user)
        
    except Exception as e:
        logger.error(f"Failed to find thread context: {e}")
        return (None, None)


async def create_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    title: str,
    message: str,
    notification_type: str = "email",
    reference_id: Optional[uuid.UUID] = None,
    reference_type: Optional[str] = None
):
    """Create an in-app notification for a user."""
    try:
        notification = Notification(
            user_id=user_id,
            title=title,
            message=message,
            type=notification_type,
            reference_id=reference_id,
            reference_type=reference_type
        )
        db.add(notification)
        await db.flush()
        logger.info(f"Created notification for user {user_id}: {title}")
    except Exception as e:
        logger.error(f"Failed to create notification: {e}")


@router.post("/inbound")
async def receive_inbound_email(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """
    Receive incoming emails from SendGrid Inbound Parse.
    
    SendGrid sends a multipart/form-data POST with:
    - from: Sender email
    - to: Recipient email (our inbound address)
    - subject: Email subject
    - text: Plain text body
    - html: HTML body
    - headers: Raw email headers (for threading)
    - attachments: File attachments (if any)
    """
    try:
        # Parse form data
        form = await request.form()
        
        # Extract fields
        from_raw = form.get("from", "")
        to_raw = form.get("to", "")
        subject = form.get("subject", "")
        text_body = form.get("text", "")
        html_body = form.get("html", "")
        headers_raw = form.get("headers", "")
        
        # Parse from/to addresses
        from_email, from_name = parse_email_address(str(from_raw))
        to_email, to_name = parse_email_address(str(to_raw))
        
        logger.info(f"Received inbound email: from={from_email}, to={to_email}, subject={subject}")
        
        # Parse headers for threading
        in_reply_to = None
        references = None
        message_id = None
        
        if headers_raw:
            headers_str = str(headers_raw)
            for line in headers_str.split('\n'):
                line_lower = line.lower()
                if line_lower.startswith('in-reply-to:'):
                    in_reply_to = line.split(':', 1)[1].strip()
                elif line_lower.startswith('references:'):
                    references = line.split(':', 1)[1].strip()
                elif line_lower.startswith('message-id:'):
                    message_id = line.split(':', 1)[1].strip()
        
        # Find user and dealership from the inbound address
        user, dealership = await find_user_from_inbound_address(to_email, db)
        
        # Find lead - first try threading, then email match
        lead, thread_user = await find_lead_from_thread(in_reply_to, references, db)
        
        # If threading found a user, prefer that (it's the original sender)
        if thread_user:
            user = thread_user
        
        # If no lead from threading, try to find by sender email
        if not lead:
            dealership_id = dealership.id if dealership else (user.dealership_id if user else None)
            lead = await find_lead_from_email(from_email, dealership_id, db)
        
        # Check if this email already exists (prevent duplicates)
        if message_id:
            existing = await db.execute(
                select(EmailLog).where(EmailLog.message_id == message_id.strip('<>'))
            )
            if existing.scalar_one_or_none():
                logger.info(f"Email already exists, skipping: {message_id}")
                return JSONResponse({"status": "duplicate"})
        
        # Create email log entry
        email_log = EmailLog(
            lead_id=lead.id if lead else None,
            user_id=user.id if user else None,
            message_id=message_id.strip('<>') if message_id else None,
            in_reply_to=in_reply_to.strip('<>') if in_reply_to else None,
            references=references,
            direction=EmailDirection.RECEIVED,
            from_email=from_email,
            to_email=to_email,
            subject=str(subject) if subject else None,
            body_text=str(text_body) if text_body else None,
            body_html=str(html_body) if html_body else None,
            is_read=False,
            received_at=datetime.utcnow(),
            delivery_status=EmailDeliveryStatus.DELIVERED
        )
        
        db.add(email_log)
        await db.flush()
        
        # Create notification for the user
        if user:
            lead_name = f"{lead.first_name} {lead.last_name}" if lead else from_email
            await create_notification(
                db=db,
                user_id=user.id,
                title="New Email Reply",
                message=f"Reply from {lead_name}: {subject}",
                notification_type="email_reply",
                reference_id=email_log.id,
                reference_type="email"
            )
        
        await db.commit()
        
        logger.info(
            f"Inbound email processed: id={email_log.id}, "
            f"user={user.email if user else 'unknown'}, "
            f"lead={lead.email if lead else 'unknown'}"
        )
        
        return JSONResponse({"status": "ok", "email_id": str(email_log.id)})
        
    except Exception as e:
        logger.error(f"Failed to process inbound email: {e}", exc_info=True)
        await db.rollback()
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@router.post("/events")
async def receive_events(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """
    Receive delivery events from SendGrid Event Webhook.
    
    Events include: processed, delivered, open, click, bounce, dropped, spam_report, etc.
    """
    try:
        # Get raw body for signature verification
        body = await request.body()
        
        # Verify signature (optional but recommended)
        signature = request.headers.get("X-Twilio-Email-Event-Webhook-Signature", "")
        timestamp = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp", "")
        
        if signature and timestamp:
            if not verify_sendgrid_signature(body, signature, timestamp):
                logger.warning("Invalid SendGrid webhook signature")
                raise HTTPException(status_code=401, detail="Invalid signature")
        
        # Parse events
        events = json.loads(body)
        
        if not isinstance(events, list):
            events = [events]
        
        processed = 0
        
        for event in events:
            event_type = event.get("event", "")
            sg_message_id = event.get("sg_message_id", "")
            email = event.get("email", "")
            timestamp_unix = event.get("timestamp", 0)
            
            # Map SendGrid event to our status
            status_map = {
                "processed": EmailDeliveryStatus.SENT,
                "delivered": EmailDeliveryStatus.DELIVERED,
                "open": EmailDeliveryStatus.OPENED,
                "click": EmailDeliveryStatus.CLICKED,
                "bounce": EmailDeliveryStatus.BOUNCED,
                "dropped": EmailDeliveryStatus.DROPPED,
                "spamreport": EmailDeliveryStatus.SPAM,
                "deferred": EmailDeliveryStatus.PENDING,
            }
            
            new_status = status_map.get(event_type)
            if not new_status:
                continue
            
            # Find the email by SendGrid message ID or by matching to_email
            email_log = None
            
            if sg_message_id:
                # Try to find by sendgrid_message_id
                result = await db.execute(
                    select(EmailLog).where(
                        EmailLog.sendgrid_message_id == sg_message_id.split('.')[0]
                    )
                )
                email_log = result.scalar_one_or_none()
            
            if not email_log and email:
                # Fallback: find recent sent email to this address
                result = await db.execute(
                    select(EmailLog).where(
                        and_(
                            EmailLog.to_email == email,
                            EmailLog.direction == EmailDirection.SENT
                        )
                    ).order_by(EmailLog.created_at.desc()).limit(1)
                )
                email_log = result.scalar_one_or_none()
            
            if not email_log:
                logger.debug(f"No matching email found for event: {event_type}, sg_id={sg_message_id}")
                continue
            
            # Update status
            email_log.delivery_status = new_status
            
            event_time = datetime.utcfromtimestamp(timestamp_unix) if timestamp_unix else datetime.utcnow()
            
            if event_type == "delivered":
                email_log.delivered_at = event_time
            elif event_type == "open":
                email_log.opened_at = event_time
                email_log.open_count = (email_log.open_count or 0) + 1
            elif event_type == "click":
                email_log.clicked_at = event_time
                email_log.click_count = (email_log.click_count or 0) + 1
            elif event_type == "bounce":
                email_log.bounce_reason = event.get("reason", "Unknown bounce reason")
            
            processed += 1
            
            logger.info(f"Updated email {email_log.id} status to {new_status.value}")
        
        await db.commit()
        
        return JSONResponse({"status": "ok", "processed": processed})
        
    except json.JSONDecodeError:
        logger.error("Invalid JSON in webhook payload")
        return JSONResponse({"status": "error", "message": "Invalid JSON"}, status_code=400)
    except Exception as e:
        logger.error(f"Failed to process events: {e}", exc_info=True)
        await db.rollback()
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@router.get("/status")
async def webhook_status() -> Dict[str, Any]:
    """
    Check webhook configuration status.
    """
    return {
        "sendgrid_configured": settings.is_sendgrid_configured,
        "inbound_domain": settings.sendgrid_inbound_domain or "Not configured",
        "webhook_key_set": bool(settings.sendgrid_webhook_key),
        "endpoints": {
            "inbound": "/api/v1/webhooks/sendgrid/inbound",
            "events": "/api/v1/webhooks/sendgrid/events"
        }
    }
