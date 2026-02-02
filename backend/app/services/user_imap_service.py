"""
User IMAP Service - Fetches emails from each user's inbox
"""
import imaplib
import email
from email.header import decode_header
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
import logging
import re

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value
from app.models.user import User
from app.models.lead import Lead
from app.models.email_log import EmailLog, EmailDirection
from app.models.notification import Notification

logger = logging.getLogger(__name__)

# Hostinger IMAP settings
IMAP_HOST = "imap.hostinger.com"
IMAP_PORT = 993


def decode_email_header(header_value: str) -> str:
    """Decode email header (handles encoded subjects, names, etc.)"""
    if not header_value:
        return ""
    
    decoded_parts = []
    for part, encoding in decode_header(header_value):
        if isinstance(part, bytes):
            try:
                decoded_parts.append(part.decode(encoding or 'utf-8', errors='replace'))
            except:
                decoded_parts.append(part.decode('utf-8', errors='replace'))
        else:
            decoded_parts.append(part)
    
    return ' '.join(decoded_parts)


def extract_email_address(email_string: str) -> str:
    """Extract email address from 'Name <email@example.com>' format"""
    if not email_string:
        return ""
    
    match = re.search(r'<([^>]+)>', email_string)
    if match:
        return match.group(1).lower().strip()
    return email_string.lower().strip()


def get_email_body(msg) -> tuple[str, str]:
    """Extract text and HTML body from email message"""
    body_text = ""
    body_html = ""
    
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            
            if "attachment" in content_disposition:
                continue
            
            try:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    text = payload.decode(charset, errors='replace')
                    
                    if content_type == "text/plain" and not body_text:
                        body_text = text
                    elif content_type == "text/html" and not body_html:
                        body_html = text
            except Exception as e:
                logger.warning(f"Failed to decode email part: {e}")
    else:
        content_type = msg.get_content_type()
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or 'utf-8'
                text = payload.decode(charset, errors='replace')
                
                if content_type == "text/plain":
                    body_text = text
                elif content_type == "text/html":
                    body_html = text
        except Exception as e:
            logger.warning(f"Failed to decode email body: {e}")
    
    return body_text, body_html


async def find_lead_by_email(db: AsyncSession, email_address: str, user_id) -> Optional[Lead]:
    """Find a lead by their email address that belongs to this user"""
    result = await db.execute(
        select(Lead).where(
            and_(
                Lead.email == email_address,
                Lead.assigned_to == user_id
            )
        )
    )
    return result.scalar_one_or_none()


async def find_lead_by_thread(db: AsyncSession, message_id: str, references: str, user_id) -> Optional[Lead]:
    """Find lead by matching email thread (In-Reply-To or References)"""
    # Check if this is a reply to an email we sent
    message_ids_to_check = []
    
    if message_id:
        message_ids_to_check.append(message_id.strip('<>'))
    
    if references:
        # References header contains space-separated message IDs
        for ref in references.split():
            message_ids_to_check.append(ref.strip('<>'))
    
    for mid in message_ids_to_check:
        result = await db.execute(
            select(EmailLog).where(
                and_(
                    EmailLog.message_id == mid,
                    EmailLog.user_id == user_id,
                    EmailLog.direction == EmailDirection.SENT
                )
            )
        )
        sent_email = result.scalar_one_or_none()
        if sent_email and sent_email.lead_id:
            # Found the original sent email, get the lead
            lead_result = await db.execute(
                select(Lead).where(Lead.id == sent_email.lead_id)
            )
            return lead_result.scalar_one_or_none()
    
    return None


async def email_already_exists(db: AsyncSession, message_id: str, user_id) -> bool:
    """Check if we've already processed this email"""
    if not message_id:
        return False
    
    result = await db.execute(
        select(EmailLog).where(
            and_(
                EmailLog.message_id == message_id.strip('<>'),
                EmailLog.user_id == user_id
            )
        )
    )
    return result.scalar_one_or_none() is not None


async def create_notification(db: AsyncSession, user_id, lead_id, subject: str, from_email: str, email_id=None):
    """Create in-app notification for new email"""
    from app.models.notification import NotificationType
    
    notification = Notification(
        user_id=user_id,
        type=NotificationType.EMAIL_RECEIVED,
        title="New Email Reply",
        message=f"Reply from {from_email}: {subject[:50]}..." if len(subject) > 50 else f"Reply from {from_email}: {subject}",
        link=f"/communications?email={email_id}" if email_id else "/communications",
        related_id=lead_id,
        related_type="lead",
        is_read=False
    )
    db.add(notification)


async def sync_user_inbox(db: AsyncSession, user: User) -> Dict[str, Any]:
    """
    Sync a single user's IMAP inbox
    Returns stats about the sync
    """
    stats = {
        "user_email": user.smtp_email,
        "emails_fetched": 0,
        "emails_matched": 0,
        "errors": []
    }
    
    # Check if user has email configured
    if not user.smtp_email or not user.smtp_password_encrypted:
        return stats
    
    try:
        # Decrypt password
        password = decrypt_value(user.smtp_password_encrypted)
    except Exception as e:
        stats["errors"].append(f"Failed to decrypt password: {e}")
        return stats
    
    try:
        # Connect to IMAP
        imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        imap.login(user.smtp_email, password)
        imap.select('INBOX')
        
        # Search for recent emails (last 7 days)
        since_date = (datetime.now() - timedelta(days=7)).strftime("%d-%b-%Y")
        _, message_numbers = imap.search(None, f'(SINCE {since_date})')
        
        email_ids = message_numbers[0].split()
        
        for email_id in email_ids[-50:]:  # Process last 50 emails max
            try:
                _, msg_data = imap.fetch(email_id, '(RFC822)')
                
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        
                        # Get message ID
                        message_id = msg.get('Message-ID', '')
                        
                        # Skip if already processed
                        if await email_already_exists(db, message_id, user.id):
                            continue
                        
                        stats["emails_fetched"] += 1
                        
                        # Extract email details
                        from_email_addr = extract_email_address(msg.get('From', ''))
                        to_email = extract_email_address(msg.get('To', ''))
                        subject = decode_email_header(msg.get('Subject', ''))
                        in_reply_to = msg.get('In-Reply-To', '')
                        references = msg.get('References', '')
                        
                        # Skip emails we sent (they appear in inbox too sometimes)
                        if from_email_addr.lower() == user.smtp_email.lower():
                            continue
                        
                        # Get email body
                        body_text, body_html = get_email_body(msg)
                        
                        # Parse date
                        date_str = msg.get('Date', '')
                        try:
                            received_at = email.utils.parsedate_to_datetime(date_str)
                        except:
                            received_at = datetime.utcnow()
                        
                        # Try to match to a lead
                        lead = None
                        
                        # First try thread matching (most accurate for replies)
                        if in_reply_to or references:
                            lead = await find_lead_by_thread(db, in_reply_to, references, user.id)
                        
                        # Fall back to email address matching
                        if not lead:
                            lead = await find_lead_by_email(db, from_email_addr, user.id)
                        
                        # Create email log
                        email_log = EmailLog(
                            lead_id=lead.id if lead else None,
                            user_id=user.id,
                            direction=EmailDirection.RECEIVED,
                            from_email=from_email_addr,
                            to_email=to_email,
                            subject=subject,
                            body_text=body_text,
                            body_html=body_html,
                            message_id=message_id.strip('<>') if message_id else None,
                            in_reply_to=in_reply_to.strip('<>') if in_reply_to else None,
                            received_at=received_at,
                            is_read=False
                        )
                        db.add(email_log)
                        await db.flush()  # Flush to get the email_log.id
                        
                        if lead:
                            stats["emails_matched"] += 1
                        
                        # Create notification for new email (whether matched to lead or not)
                        await create_notification(
                            db, 
                            user.id, 
                            lead.id if lead else None, 
                            subject, 
                            from_email_addr,
                            email_log.id
                        )
                        
            except Exception as e:
                logger.warning(f"Error processing email {email_id}: {e}")
                stats["errors"].append(str(e))
        
        imap.logout()
        
        # Update last sync time
        user.imap_last_sync_at = datetime.utcnow()
        db.add(user)
        await db.commit()
        
    except imaplib.IMAP4.error as e:
        stats["errors"].append(f"IMAP error: {e}")
        logger.error(f"IMAP error for user {user.smtp_email}: {e}")
    except Exception as e:
        stats["errors"].append(f"Unexpected error: {e}")
        logger.error(f"Unexpected error syncing inbox for {user.smtp_email}: {e}")
    
    return stats


async def sync_all_user_inboxes(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    Sync IMAP inboxes for all users with email configured
    Called by scheduler every 2 minutes
    """
    logger.info("Starting IMAP sync for all users...")
    
    # Get all users with email configured
    result = await db.execute(
        select(User).where(
            and_(
                User.smtp_email.isnot(None),
                User.smtp_password_encrypted.isnot(None),
                User.is_active == True
            )
        )
    )
    users = result.scalars().all()
    
    all_stats = []
    
    for user in users:
        try:
            stats = await sync_user_inbox(db, user)
            all_stats.append(stats)
            
            if stats["emails_fetched"] > 0:
                logger.info(
                    f"Synced inbox for {user.smtp_email}: "
                    f"{stats['emails_fetched']} fetched, {stats['emails_matched']} matched to leads"
                )
        except Exception as e:
            logger.error(f"Failed to sync inbox for {user.smtp_email}: {e}")
            all_stats.append({
                "user_email": user.smtp_email,
                "emails_fetched": 0,
                "emails_matched": 0,
                "errors": [str(e)]
            })
    
    logger.info(f"IMAP sync completed for {len(users)} users")
    return all_stats
