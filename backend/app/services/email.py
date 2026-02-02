"""
Email Service for Gmail Integration
"""
from typing import Any, Dict, List, Optional
from uuid import UUID
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.email_log import EmailLog
from app.models.activity import ActivityType
from app.services.activity import ActivityService


class EmailService:
    """Service for handling email communication and Gmail synchronization"""

    @staticmethod
    async def log_email(
        db: AsyncSession,
        *,
        lead_id: UUID,
        user_id: UUID,
        subject: str,
        body: str,
        direction: str,  # 'sent' or 'received'
        gmail_message_id: Optional[str] = None
    ) -> EmailLog:
        """
        Log an email communication.
        """
        email_log = EmailLog(
            lead_id=lead_id,
            user_id=user_id,
            subject=subject,
            body=body,
            direction=direction,
            gmail_message_id=gmail_message_id,
            sent_at=datetime.utcnow()
        )
        
        db.add(email_log)
        await db.flush()
        
        # Log as activity
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.EMAIL_SENT if direction == "sent" else ActivityType.NOTE_ADDED,
            description=f"Email {direction}: {subject}",
            user_id=user_id,
            lead_id=lead_id,
            dealership_id=None, # Will be fetched from user in production
            meta_data={"subject": subject, "email_id": str(email_log.id)}
        )
        
        return email_log

    @staticmethod
    async def get_lead_emails(
        db: AsyncSession,
        lead_id: UUID
    ) -> List[EmailLog]:
        """
        Get all email logs for a specific lead.
        """
        result = await db.execute(
            select(EmailLog)
            .where(EmailLog.lead_id == lead_id)
            .order_by(EmailLog.sent_at.desc())
        )
        return result.scalars().all()
