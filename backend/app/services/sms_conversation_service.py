"""
SMS Conversation Service - Manages SMS conversations with leads
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from uuid import UUID

from sqlalchemy import select, or_, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.sms_log import SMSLog, MessageDirection, SMSStatus
from app.models.lead import Lead
from app.models.user import User
from app.models.activity import ActivityType
from app.services.sms_service import sms_service

logger = logging.getLogger(__name__)


class SMSConversationService:
    """
    Service for managing SMS conversations.
    Handles sending, receiving, and tracking SMS messages.
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def find_lead_by_phone(self, phone: str) -> Optional[Lead]:
        """Find a lead by phone number"""
        # Normalize phone number for search
        normalized = ''.join(c for c in phone if c.isdigit())
        
        # Search in both phone and alternate_phone
        result = await self.db.execute(
            select(Lead).where(
                or_(
                    Lead.phone.ilike(f"%{normalized[-10:]}%"),
                    Lead.alternate_phone.ilike(f"%{normalized[-10:]}%")
                )
            ).limit(1)
        )
        return result.scalar_one_or_none()
    
    async def send_sms(
        self,
        to_number: str,
        body: str,
        user_id: UUID,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None
    ) -> Tuple[bool, Optional[SMSLog], Optional[str]]:
        """
        Send an SMS message and store in database.
        
        Returns:
            Tuple of (success, sms_log, error_message)
        """
        # Format phone number
        formatted_number = sms_service.format_phone_number(to_number)
        if not formatted_number:
            return False, None, "Invalid phone number"
        
        # Try to find lead if not provided
        if not lead_id:
            lead = await self.find_lead_by_phone(formatted_number)
            if lead:
                lead_id = lead.id
                dealership_id = dealership_id or lead.dealership_id
        
        # Create SMS log entry
        sms_log = SMSLog(
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            twilio_message_sid="pending",  # Will be updated
            direction=MessageDirection.OUTBOUND,
            from_number=settings.twilio_phone_number,
            to_number=formatted_number,
            body=body,
            status=SMSStatus.QUEUED,
            sent_at=utc_now()
        )
        
        self.db.add(sms_log)
        await self.db.flush()
        
        # Send via Twilio
        result = await sms_service.send_sms(formatted_number, body)
        
        if result.get("success"):
            sms_log.twilio_message_sid = result["message_sid"]
            sms_log.status = SMSStatus.SENT
            await self.db.flush()
            
            # Log activity
            await self._log_sms_activity(
                sms_log,
                ActivityType.SMS_SENT,
                f"SMS sent to {formatted_number}"
            )
            
            return True, sms_log, None
        else:
            sms_log.status = SMSStatus.FAILED
            sms_log.error_message = result.get("error", "Unknown error")
            await self.db.flush()
            
            return False, sms_log, result.get("error")
    
    async def receive_sms(
        self,
        message_sid: str,
        from_number: str,
        to_number: str,
        body: str,
        media_urls: Optional[List[str]] = None
    ) -> SMSLog:
        """
        Process incoming SMS webhook and store message.
        """
        # Find lead by phone number
        lead = await self.find_lead_by_phone(from_number)
        
        # Create SMS log
        sms_log = SMSLog(
            lead_id=lead.id if lead else None,
            dealership_id=lead.dealership_id if lead else None,
            user_id=lead.assigned_to if lead else None,
            twilio_message_sid=message_sid,
            direction=MessageDirection.INBOUND,
            from_number=from_number,
            to_number=to_number,
            body=body,
            media_urls=media_urls or [],
            status=SMSStatus.RECEIVED,
            received_at=utc_now(),
            is_read=False
        )
        
        self.db.add(sms_log)
        await self.db.flush()
        
        # Log activity
        if lead:
            await self._log_sms_activity(
                sms_log,
                ActivityType.SMS_RECEIVED,
                f"SMS received from {from_number}"
            )
        
        return sms_log
    
    async def update_delivery_status(
        self,
        message_sid: str,
        status: str,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> Optional[SMSLog]:
        """Update SMS delivery status from webhook"""
        result = await self.db.execute(
            select(SMSLog).where(SMSLog.twilio_message_sid == message_sid)
        )
        sms_log = result.scalar_one_or_none()
        
        if not sms_log:
            logger.warning(f"SMS log not found for SID: {message_sid}")
            return None
        
        # Map Twilio status
        status_map = {
            "queued": SMSStatus.QUEUED,
            "sending": SMSStatus.SENDING,
            "sent": SMSStatus.SENT,
            "delivered": SMSStatus.DELIVERED,
            "undelivered": SMSStatus.UNDELIVERED,
            "failed": SMSStatus.FAILED
        }
        
        new_status = status_map.get(status.lower())
        if new_status:
            sms_log.status = new_status
        
        if new_status == SMSStatus.DELIVERED:
            sms_log.delivered_at = utc_now()
        
        if error_code:
            sms_log.error_code = error_code
        if error_message:
            sms_log.error_message = error_message
        
        await self.db.flush()
        return sms_log
    
    async def mark_as_read(self, sms_id: UUID) -> Optional[SMSLog]:
        """Mark a message as read"""
        result = await self.db.execute(
            select(SMSLog).where(SMSLog.id == sms_id)
        )
        sms_log = result.scalar_one_or_none()
        
        if sms_log and not sms_log.is_read:
            sms_log.is_read = True
            sms_log.read_at = utc_now()
            await self.db.flush()
        
        return sms_log
    
    async def mark_conversation_as_read(self, lead_id: UUID) -> int:
        """Mark all unread messages in a conversation as read"""
        result = await self.db.execute(
            select(SMSLog).where(
                SMSLog.lead_id == lead_id,
                SMSLog.is_read == False,
                SMSLog.direction == MessageDirection.INBOUND
            )
        )
        messages = result.scalars().all()
        
        count = 0
        for msg in messages:
            msg.is_read = True
            msg.read_at = utc_now()
            count += 1
        
        await self.db.flush()
        return count
    
    async def get_conversation(
        self,
        lead_id: UUID,
        limit: int = 50,
        before: Optional[datetime] = None
    ) -> List[SMSLog]:
        """Get SMS conversation with a lead"""
        query = select(SMSLog).where(
            SMSLog.lead_id == lead_id
        )
        
        if before:
            query = query.where(SMSLog.created_at < before)
        
        query = query.order_by(SMSLog.created_at.desc()).limit(limit)
        
        result = await self.db.execute(query)
        return list(reversed(result.scalars().all()))
    
    async def get_conversations_list(
        self,
        user_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        unread_only: bool = False,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Get list of SMS conversations with last message and unread count.
        Returns grouped by lead.
        """
        # Subquery to get last message per lead
        subq = (
            select(
                SMSLog.lead_id,
                func.max(SMSLog.created_at).label("last_message_at")
            )
            .where(SMSLog.lead_id.isnot(None))
            .group_by(SMSLog.lead_id)
        ).subquery()
        
        # Main query with lead info
        query = (
            select(
                SMSLog,
                Lead.first_name,
                Lead.last_name,
                Lead.phone,
                func.count().filter(
                    and_(
                        SMSLog.is_read == False,
                        SMSLog.direction == MessageDirection.INBOUND
                    )
                ).over(partition_by=SMSLog.lead_id).label("unread_count")
            )
            .join(subq, and_(
                SMSLog.lead_id == subq.c.lead_id,
                SMSLog.created_at == subq.c.last_message_at
            ))
            .join(Lead, SMSLog.lead_id == Lead.id)
        )
        
        # Apply filters
        if user_id:
            query = query.where(Lead.assigned_to == user_id)
        if dealership_id:
            query = query.where(Lead.dealership_id == dealership_id)
        if unread_only:
            query = query.where(
                SMSLog.is_read == False,
                SMSLog.direction == MessageDirection.INBOUND
            )
        
        query = query.order_by(SMSLog.created_at.desc()).offset(offset).limit(limit)
        
        result = await self.db.execute(query)
        rows = result.all()
        
        conversations = []
        for row in rows:
            sms, first_name, last_name, phone, unread_count = row
            conversations.append({
                "lead_id": str(sms.lead_id),
                "lead_name": f"{first_name} {last_name or ''}".strip(),
                "lead_phone": phone,
                "last_message": {
                    "id": str(sms.id),
                    "body": sms.body,
                    "direction": sms.direction.value,
                    "created_at": sms.created_at.isoformat(),
                    "status": sms.status.value
                },
                "unread_count": unread_count
            })
        
        return conversations
    
    async def get_unread_count(
        self,
        user_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None
    ) -> int:
        """Get total unread SMS count"""
        query = select(func.count(SMSLog.id)).where(
            SMSLog.is_read == False,
            SMSLog.direction == MessageDirection.INBOUND
        )
        
        if user_id:
            # Filter by leads assigned to user
            query = query.join(Lead).where(Lead.assigned_to == user_id)
        elif dealership_id:
            query = query.where(SMSLog.dealership_id == dealership_id)
        
        result = await self.db.execute(query)
        return result.scalar() or 0
    
    async def _log_sms_activity(
        self,
        sms_log: SMSLog,
        activity_type: ActivityType,
        description: str
    ) -> None:
        """Create activity record for SMS"""
        if sms_log.activity_logged:
            return
        
        from app.services.activity import ActivityService
        
        await ActivityService.log_activity(
            db=self.db,
            activity_type=activity_type,
            description=description,
            user_id=sms_log.user_id,
            lead_id=sms_log.lead_id,
            dealership_id=sms_log.dealership_id,
            meta_data={
                "sms_log_id": str(sms_log.id),
                "message_sid": sms_log.twilio_message_sid,
                "direction": sms_log.direction.value,
                "from_number": sms_log.from_number,
                "to_number": sms_log.to_number,
                "body_preview": sms_log.body[:100] if sms_log.body else ""
            }
        )
        
        sms_log.activity_logged = True
        await self.db.flush()


def get_sms_conversation_service(db: AsyncSession) -> SMSConversationService:
    return SMSConversationService(db)
