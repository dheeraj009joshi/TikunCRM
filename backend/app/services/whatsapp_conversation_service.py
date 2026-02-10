"""
WhatsApp Conversation Service - Manages WhatsApp conversations with leads (customer-level)
"""
import logging
import uuid as uuid_module
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
from uuid import UUID

from sqlalchemy import select, or_, func, and_, literal_column
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.whatsapp_log import WhatsAppLog, WhatsAppDirection, WhatsAppStatus
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.activity import ActivityType
from app.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)


class WhatsAppConversationService:
    """Service for WhatsApp conversations; customer-level threading like SMS."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_customer_by_phone(self, phone: str) -> Optional[Customer]:
        """Normalize and find customer by phone."""
        normalized = "".join(c for c in phone if c.isdigit())
        if len(normalized) < 10:
            return None
        suffix = normalized[-10:]
        result = await self.db.execute(
            select(Customer).where(
                or_(
                    Customer.phone.ilike(f"%{suffix}"),
                    Customer.alternate_phone.ilike(f"%{suffix}"),
                )
            ).limit(1)
        )
        return result.scalar_one_or_none()

    async def find_lead_by_phone(self, phone: str) -> Optional[Lead]:
        """Latest lead for customer matching phone."""
        customer = await self.find_customer_by_phone(phone)
        if not customer:
            return None
        result = await self.db.execute(
            select(Lead)
            .where(Lead.customer_id == customer.id)
            .order_by(Lead.updated_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def send_whatsapp(
        self,
        to_number: str,
        body: str,
        user_id: UUID,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None
    ) -> Tuple[bool, Optional[WhatsAppLog], Optional[str]]:
        """Send WhatsApp and store log. Returns (success, log, error)."""
        formatted = whatsapp_service.format_phone_number(to_number)
        if not formatted:
            return False, None, "Invalid phone number"

        lead = None
        customer_id = None
        if lead_id:
            r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
            lead = r.scalar_one_or_none()
            if lead:
                customer_id = lead.customer_id
                dealership_id = dealership_id or lead.dealership_id
        if not lead:
            lead = await self.find_lead_by_phone(formatted)
            if lead:
                lead_id = lead.id
                customer_id = lead.customer_id
                dealership_id = dealership_id or lead.dealership_id
            else:
                customer = await self.find_customer_by_phone(formatted)
                if customer:
                    customer_id = customer.id

        wa_log = WhatsAppLog(
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            twilio_message_sid=f"pending_{uuid_module.uuid4().hex}",
            direction=WhatsAppDirection.OUTBOUND,
            from_number=settings.twilio_whatsapp_number,
            to_number=formatted,
            body=body,
            status=WhatsAppStatus.QUEUED,
            sent_at=utc_now()
        )
        self.db.add(wa_log)
        await self.db.flush()

        status_callback_url = f"{settings.backend_url.rstrip('/')}/api/v1/webhooks/twilio/whatsapp/status"
        result = await whatsapp_service.send_whatsapp(formatted, body, status_callback=status_callback_url)
        if result.get("success"):
            wa_log.twilio_message_sid = result["message_sid"]
            wa_log.status = WhatsAppStatus.SENT
            await self.db.flush()
            await self._log_activity(
                wa_log,
                ActivityType.WHATSAPP_SENT,
                f"WhatsApp sent to {formatted}"
            )
            return True, wa_log, None
        wa_log.status = WhatsAppStatus.FAILED
        wa_log.error_message = result.get("error", "Unknown error")
        wa_log.error_code = result.get("error_code")
        await self.db.flush()
        return False, wa_log, result.get("error")

    async def send_whatsapp_template(
        self,
        to_number: str,
        content_sid: str,
        content_variables: Dict[str, str],
        user_id: UUID,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> Tuple[bool, Optional[WhatsAppLog], Optional[str]]:
        """Send WhatsApp template (Content SID + variables). Returns (success, log, error)."""
        formatted = whatsapp_service.format_phone_number(to_number)
        if not formatted:
            return False, None, "Invalid phone number"

        lead = None
        customer_id = None
        if lead_id:
            r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
            lead = r.scalar_one_or_none()
            if lead:
                customer_id = lead.customer_id
                dealership_id = dealership_id or lead.dealership_id
        if not lead:
            lead = await self.find_lead_by_phone(formatted)
            if lead:
                lead_id = lead.id
                customer_id = lead.customer_id
                dealership_id = dealership_id or lead.dealership_id
            else:
                customer = await self.find_customer_by_phone(formatted)
                if customer:
                    customer_id = customer.id

        body_display = f"[Template {content_sid[:12]}...]" if len(content_sid) > 12 else f"[Template {content_sid}]"
        wa_log = WhatsAppLog(
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            twilio_message_sid=f"pending_{uuid_module.uuid4().hex}",
            direction=WhatsAppDirection.OUTBOUND,
            from_number=settings.twilio_whatsapp_number,
            to_number=formatted,
            body=body_display,
            status=WhatsAppStatus.QUEUED,
            sent_at=utc_now(),
        )
        self.db.add(wa_log)
        await self.db.flush()

        status_callback_url = f"{settings.backend_url.rstrip('/')}/api/v1/webhooks/twilio/whatsapp/status"
        result = await whatsapp_service.send_whatsapp_template(
            formatted,
            content_sid,
            content_variables,
            status_callback=status_callback_url,
        )
        if result.get("success"):
            wa_log.twilio_message_sid = result["message_sid"]
            wa_log.status = WhatsAppStatus.SENT
            await self.db.flush()
            await self._log_activity(
                wa_log,
                ActivityType.WHATSAPP_SENT,
                f"WhatsApp template sent to {formatted}",
            )
            return True, wa_log, None
        wa_log.status = WhatsAppStatus.FAILED
        wa_log.error_message = result.get("error", "Unknown error")
        wa_log.error_code = result.get("error_code")
        await self.db.flush()
        return False, wa_log, result.get("error")

    async def receive_whatsapp(
        self,
        message_sid: str,
        from_number: str,
        to_number: str,
        body: str,
        media_urls: Optional[List[str]] = None
    ) -> WhatsAppLog:
        """Process incoming WhatsApp webhook."""
        customer = await self.find_customer_by_phone(from_number)
        lead = await self.find_lead_by_phone(from_number) if customer else None
        customer_id = customer.id if customer else None
        lead_id = lead.id if lead else None
        dealership_id = lead.dealership_id if lead else None
        user_id = lead.assigned_to if lead else None

        wa_log = WhatsAppLog(
            customer_id=customer_id,
            lead_id=lead_id,
            dealership_id=dealership_id,
            user_id=user_id,
            twilio_message_sid=message_sid,
            direction=WhatsAppDirection.INBOUND,
            from_number=from_number,
            to_number=to_number,
            body=body,
            media_urls=media_urls or [],
            status=WhatsAppStatus.RECEIVED,
            received_at=utc_now(),
            is_read=False
        )
        self.db.add(wa_log)
        await self.db.flush()
        if lead:
            await self._log_activity(
                wa_log,
                ActivityType.WHATSAPP_RECEIVED,
                f"WhatsApp received from {from_number}"
            )
        return wa_log

    async def update_delivery_status(
        self,
        message_sid: str,
        status: str,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> Optional[WhatsAppLog]:
        """Update WhatsApp delivery status from Twilio status callback webhook."""
        result = await self.db.execute(
            select(WhatsAppLog).where(WhatsAppLog.twilio_message_sid == message_sid)
        )
        wa_log = result.scalar_one_or_none()
        if not wa_log:
            logger.warning(f"WhatsApp log not found for SID: {message_sid}")
            return None
        status_map = {
            "queued": WhatsAppStatus.QUEUED,
            "sending": WhatsAppStatus.SENDING,
            "sent": WhatsAppStatus.SENT,
            "delivered": WhatsAppStatus.DELIVERED,
            "read": WhatsAppStatus.READ,
            "undelivered": WhatsAppStatus.UNDELIVERED,
            "failed": WhatsAppStatus.FAILED,
        }
        new_status = status_map.get((status or "").lower())
        if new_status:
            wa_log.status = new_status
        if new_status == WhatsAppStatus.DELIVERED:
            wa_log.delivered_at = utc_now()
        if error_code:
            wa_log.error_code = error_code
        if error_message:
            wa_log.error_message = error_message
        await self.db.flush()
        return wa_log

    async def mark_conversation_as_read(self, lead_id: UUID) -> int:
        """Mark all unread inbound WhatsApp messages for this lead's customer as read."""
        r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
        lead = r.scalar_one_or_none()
        if not lead:
            return 0
        customer_id = lead.customer_id
        q = select(WhatsAppLog).where(
            WhatsAppLog.is_read == False,
            WhatsAppLog.direction == literal_column("'inbound'::whatsappdirection")
        )
        if customer_id:
            q = q.where(WhatsAppLog.customer_id == customer_id)
        else:
            q = q.where(WhatsAppLog.lead_id == lead_id)
        res = await self.db.execute(q)
        messages = res.scalars().all()
        for msg in messages:
            msg.is_read = True
            msg.read_at = utc_now()
        await self.db.flush()
        return len(messages)

    async def get_conversation(
        self,
        lead_id: UUID,
        limit: int = 50,
        before: Optional[datetime] = None
    ) -> List[WhatsAppLog]:
        """Get WhatsApp conversation for lead's customer."""
        r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
        lead = r.scalar_one_or_none()
        if not lead:
            return []
        customer_id = lead.customer_id
        q = select(WhatsAppLog)
        if customer_id:
            q = q.where(WhatsAppLog.customer_id == customer_id)
        else:
            q = q.where(WhatsAppLog.lead_id == lead_id)
        if before:
            q = q.where(WhatsAppLog.created_at < before)
        q = q.order_by(WhatsAppLog.created_at.desc()).limit(limit)
        res = await self.db.execute(q)
        return list(reversed(res.scalars().all()))

    async def get_last_inbound_at(self, lead_id: UUID) -> Optional[datetime]:
        """Return the timestamp of the most recent inbound WhatsApp message for this lead (or lead's customer)."""
        r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
        lead = r.scalar_one_or_none()
        if not lead:
            return None
        customer_id = lead.customer_id
        q = (
            select(WhatsAppLog.created_at)
            .where(WhatsAppLog.direction == WhatsAppDirection.INBOUND)
        )
        if customer_id:
            q = q.where(WhatsAppLog.customer_id == customer_id)
        else:
            q = q.where(WhatsAppLog.lead_id == lead_id)
        q = q.order_by(WhatsAppLog.created_at.desc()).limit(1)
        res = await self.db.execute(q)
        row = res.scalar_one_or_none()
        return row[0] if row else None

    async def get_conversations_list(
        self,
        user_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        unread_only: bool = False,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List of WhatsApp conversations with last message and unread count (by lead)."""
        subq = (
            select(
                WhatsAppLog.lead_id,
                func.max(WhatsAppLog.created_at).label("last_message_at")
            )
            .where(WhatsAppLog.lead_id.isnot(None))
            .group_by(WhatsAppLog.lead_id)
        ).subquery()
        query = (
            select(
                WhatsAppLog,
                Customer.first_name,
                Customer.last_name,
                Customer.phone,
                func.count().filter(
                    and_(
                        WhatsAppLog.is_read == False,
                        WhatsAppLog.direction == literal_column("'inbound'::whatsappdirection")
                    )
                ).over(partition_by=WhatsAppLog.lead_id).label("unread_count")
            )
            .join(subq, and_(
                WhatsAppLog.lead_id == subq.c.lead_id,
                WhatsAppLog.created_at == subq.c.last_message_at
            ))
            .join(Lead, WhatsAppLog.lead_id == Lead.id)
            .join(Customer, Lead.customer_id == Customer.id)
        )
        if user_id:
            query = query.where(Lead.assigned_to == user_id)
        if dealership_id:
            query = query.where(Lead.dealership_id == dealership_id)
        if unread_only:
            query = query.where(
                WhatsAppLog.is_read == False,
                WhatsAppLog.direction == literal_column("'inbound'::whatsappdirection")
            )
        query = query.order_by(WhatsAppLog.created_at.desc()).offset(offset).limit(limit)
        result = await self.db.execute(query)
        rows = result.all()
        conversations = []
        for row in rows:
            wa, first_name, last_name, phone, unread_count = row
            conversations.append({
                "lead_id": str(wa.lead_id),
                "customer_id": str(wa.customer_id) if wa.customer_id else None,
                "lead_name": f"{first_name or ''} {last_name or ''}".strip() or "Unknown",
                "lead_phone": phone,
                "last_message": {
                    "id": str(wa.id),
                    "body": wa.body,
                    "direction": wa.direction.value,
                    "created_at": wa.created_at.isoformat(),
                    "status": wa.status.value
                },
                "unread_count": unread_count
            })
        return conversations

    async def get_unread_count(
        self,
        user_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None
    ) -> int:
        """Total unread WhatsApp count for user/dealership."""
        q = select(func.count(func.distinct(WhatsAppLog.id))).where(
            WhatsAppLog.is_read == False,
            WhatsAppLog.direction == literal_column("'inbound'::whatsappdirection")
        )
        if user_id:
            q = q.join(
                Lead,
                or_(
                    WhatsAppLog.lead_id == Lead.id,
                    and_(WhatsAppLog.customer_id.isnot(None), Lead.customer_id == WhatsAppLog.customer_id)
                )
            ).where(Lead.assigned_to == user_id)
        elif dealership_id:
            q = q.join(
                Lead,
                or_(
                    WhatsAppLog.lead_id == Lead.id,
                    and_(WhatsAppLog.customer_id.isnot(None), Lead.customer_id == WhatsAppLog.customer_id)
                )
            ).where(Lead.dealership_id == dealership_id)
        res = await self.db.execute(q)
        return res.scalar() or 0

    async def mark_as_read(self, message_id: UUID) -> Optional[WhatsAppLog]:
        """Mark a single message as read."""
        r = await self.db.execute(select(WhatsAppLog).where(WhatsAppLog.id == message_id))
        wa = r.scalar_one_or_none()
        if wa and not wa.is_read:
            wa.is_read = True
            wa.read_at = utc_now()
            await self.db.flush()
        return wa

    async def _log_activity(
        self,
        wa_log: WhatsAppLog,
        activity_type: ActivityType,
        description: str
    ) -> None:
        if wa_log.activity_logged:
            return
        from app.services.activity import ActivityService
        await ActivityService.log_activity(
            db=self.db,
            activity_type=activity_type,
            description=description,
            user_id=wa_log.user_id,
            lead_id=wa_log.lead_id,
            dealership_id=wa_log.dealership_id,
            meta_data={
                "whatsapp_log_id": str(wa_log.id),
                "message_sid": wa_log.twilio_message_sid,
                "direction": wa_log.direction.value,
                "from_number": wa_log.from_number,
                "to_number": wa_log.to_number,
                "body_preview": wa_log.body[:100] if wa_log.body else ""
            }
        )
        wa_log.activity_logged = True
        await self.db.flush()


def get_whatsapp_conversation_service(db: AsyncSession) -> WhatsAppConversationService:
    return WhatsAppConversationService(db)
