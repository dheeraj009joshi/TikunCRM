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
from app.services.dealership_twilio_config_service import (
    get_effective_twilio_config,
    normalize_twilio_to_number,
)
from app.models.whatsapp_log import WhatsAppLog, WhatsAppDirection, WhatsAppStatus
from app.models.lead import Lead, LeadSource
from app.models.customer import Customer
from app.models.activity import ActivityType
from app.services.whatsapp_service import whatsapp_service
from app.services.lead_stage_service import LeadStageService

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

    async def find_lead_by_lead_phone_suffix(self, phone: str) -> Optional[Lead]:
        """Match Lead via Customer.phone by last 10 digits when customer record does not match (common CRM setup)."""
        normalized = "".join(c for c in phone if c.isdigit())
        if len(normalized) < 10:
            return None
        suffix = normalized[-10:]
        result = await self.db.execute(
            select(Lead)
            .join(Customer, Lead.customer_id == Customer.id)
            .where(Customer.phone.isnot(None), Customer.phone.ilike(f"%{suffix}%"))
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
        
        # If lead_id is explicitly provided, look it up
        if lead_id:
            r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
            lead = r.scalar_one_or_none()
            if lead:
                customer_id = lead.customer_id
                dealership_id = dealership_id or lead.dealership_id
        
        # Only try to find a lead by phone if we don't have a dealership_id yet
        # (i.e., we're not explicitly sending to an unknown contact)
        if not lead and not dealership_id:
            lead = await self.find_lead_by_phone(formatted)
            if lead:
                lead_id = lead.id
                customer_id = lead.customer_id
                dealership_id = lead.dealership_id
        if not lead and not dealership_id:
            lead = await self.find_lead_by_lead_phone_suffix(formatted)
            if lead:
                lead_id = lead.id
                customer_id = lead.customer_id
                dealership_id = lead.dealership_id
        if not lead and not dealership_id:
            customer = await self.find_customer_by_phone(formatted)
            if customer:
                customer_id = customer.id

        effective = await get_effective_twilio_config(self.db, dealership_id)
        if not effective.is_whatsapp_ready():
            return False, None, "WhatsApp not configured for this dealership"

        wa_from = normalize_twilio_to_number(effective.whatsapp_from_number)
        if not wa_from:
            wa_from = (effective.whatsapp_from_number or "").strip()
        wa_log = WhatsAppLog(
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            twilio_message_sid=f"pending_{uuid_module.uuid4().hex}",
            direction=WhatsAppDirection.OUTBOUND,
            from_number=wa_from,
            to_number=formatted,
            body=body,
            status=WhatsAppStatus.QUEUED,
            sent_at=utc_now()
        )
        self.db.add(wa_log)
        await self.db.flush()

        status_callback_url = f"{settings.backend_url.rstrip('/')}/api/v1/webhooks/twilio/whatsapp/status"
        result = await whatsapp_service.send_whatsapp(
            formatted,
            body,
            effective,
            status_callback=status_callback_url,
        )
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
        template_name: Optional[str] = None,
    ) -> Tuple[bool, Optional[WhatsAppLog], Optional[str]]:
        """Send WhatsApp template (Content SID + variables). Returns (success, log, error)."""
        formatted = whatsapp_service.format_phone_number(to_number)
        if not formatted:
            return False, None, "Invalid phone number"

        lead = None
        customer_id = None
        
        # If lead_id is explicitly provided, look it up
        if lead_id:
            r = await self.db.execute(select(Lead).where(Lead.id == lead_id))
            lead = r.scalar_one_or_none()
            if lead:
                customer_id = lead.customer_id
                dealership_id = dealership_id or lead.dealership_id
        
        # Only try to find a lead by phone if we don't have a dealership_id yet
        # (i.e., we're not explicitly sending to an unknown contact)
        if not lead and not dealership_id:
            lead = await self.find_lead_by_phone(formatted)
            if lead:
                lead_id = lead.id
                customer_id = lead.customer_id
                dealership_id = lead.dealership_id
        if not lead and not dealership_id:
            lead = await self.find_lead_by_lead_phone_suffix(formatted)
            if lead:
                lead_id = lead.id
                customer_id = lead.customer_id
                dealership_id = lead.dealership_id
        if not lead and not dealership_id:
            customer = await self.find_customer_by_phone(formatted)
            if customer:
                customer_id = customer.id

        effective = await get_effective_twilio_config(self.db, dealership_id)
        if not effective.is_whatsapp_ready():
            return False, None, "WhatsApp not configured for this dealership"

        if template_name:
            body_display = f"[Template: {template_name}]"
        else:
            body_display = f"[Template {content_sid[:12]}...]" if len(content_sid) > 12 else f"[Template {content_sid}]"
        wa_from = normalize_twilio_to_number(effective.whatsapp_from_number)
        if not wa_from:
            wa_from = (effective.whatsapp_from_number or "").strip()
        wa_log = WhatsAppLog(
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            twilio_message_sid=f"pending_{uuid_module.uuid4().hex}",
            direction=WhatsAppDirection.OUTBOUND,
            from_number=wa_from,
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
            effective,
            content_variables=content_variables,
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
        media_urls: Optional[List[str]] = None,
        media_content_types: Optional[List[str]] = None,
        resolved_dealership_id: Optional[UUID] = None,
    ) -> Tuple[WhatsAppLog, bool, Optional[Lead]]:
        """Process incoming WhatsApp webhook.
        
        Auto-creates a lead for unknown contacts if a dealership is resolved.
        
        Returns:
            Tuple of (WhatsAppLog, is_new_lead, lead_or_none)
        """
        body = str(body or "")
        sid = (message_sid or "").strip()
        if not sid:
            sid = f"wa_incoming_{uuid_module.uuid4().hex}"
            logger.warning("Incoming WhatsApp missing MessageSid/SmsSid; using generated sid=%s", sid)
        else:
            existing = await self.db.execute(
                select(WhatsAppLog).where(WhatsAppLog.twilio_message_sid == sid)
            )
            prev = existing.scalar_one_or_none()
            if prev is not None:
                logger.info("Duplicate Twilio webhook for sid=%s; returning existing log id=%s", sid, prev.id)
                # Return existing with is_new_lead=False
                return prev, False, None

        # Try to find existing customer/lead
        customer = await self.find_customer_by_phone(from_number)
        lead = await self.find_lead_by_phone(from_number) if customer else None
        if lead is None:
            lead = await self.find_lead_by_lead_phone_suffix(from_number)
        
        dealership_id = (lead.dealership_id if lead else None) or resolved_dealership_id
        is_new_lead = False
        new_lead = None
        
        # Auto-create lead for unknown sender if we have a dealership
        if lead is None and dealership_id:
            logger.info(f"Auto-creating lead for unknown WhatsApp sender {from_number}")
            try:
                customer, found_lead = await self._auto_create_lead_from_whatsapp(
                    phone_number=from_number,
                    dealership_id=dealership_id,
                )
                lead = found_lead
                # Check if this lead was just created (within last 5 seconds) to determine if truly new
                from datetime import timedelta
                if lead.created_at and (utc_now() - lead.created_at) < timedelta(seconds=5):
                    is_new_lead = True
                    new_lead = lead
                    logger.info(f"Auto-created lead {lead.id} for WhatsApp sender {from_number}")
                else:
                    logger.info(f"Found existing lead {lead.id} for WhatsApp sender {from_number}")
            except Exception as e:
                logger.error(f"Failed to auto-create lead for {from_number}: {e}", exc_info=True)
                # Continue without lead - message will still be saved
        
        customer_id = (lead.customer_id if lead and lead.customer_id else None) or (
            customer.id if customer else None
        )
        lead_id = lead.id if lead else None
        user_id = lead.assigned_to if lead else None

        wa_log = WhatsAppLog(
            customer_id=customer_id,
            lead_id=lead_id,
            dealership_id=dealership_id,
            user_id=user_id,
            twilio_message_sid=sid,
            direction=WhatsAppDirection.INBOUND,
            from_number=from_number,
            to_number=to_number,
            body=body,
            media_urls=media_urls or [],
            media_content_types=media_content_types or [],
            status=WhatsAppStatus.RECEIVED,
            received_at=utc_now(),
            is_read=False
        )
        self.db.add(wa_log)
        await self.db.flush()
        
        if lead:
            try:
                async with self.db.begin_nested():
                    await self._log_activity(
                        wa_log,
                        ActivityType.WHATSAPP_RECEIVED,
                        f"WhatsApp received from {from_number}",
                    )
            except Exception as e:
                logger.warning(
                    "WhatsApp inbound saved (id=%s) but activity log failed: %s",
                    wa_log.id,
                    e,
                    exc_info=True,
                )
        
        return wa_log, is_new_lead, new_lead

    async def _auto_create_lead_from_whatsapp(
        self,
        phone_number: str,
        dealership_id: UUID,
    ) -> Tuple[Customer, Lead]:
        """Auto-create a Customer and Lead from an incoming WhatsApp message.
        
        The lead is created with:
        - Phone number as placeholder name
        - Source = WHATSAPP_INBOUND
        - No assignment (goes to Unassigned Pool)
        - Default pipeline stage
        
        Handles race conditions where customer may be created by concurrent request.
        """
        from sqlalchemy.exc import IntegrityError
        
        normalized = "".join(c for c in phone_number if c.isdigit())
        phone_suffix = normalized[-10:] if len(normalized) >= 10 else normalized
        display_phone = self._format_phone_display(phone_number)
        
        # First, double-check for existing customer (race condition protection)
        existing_customer = await self.db.execute(
            select(Customer).where(
                or_(
                    Customer.phone == phone_suffix,
                    Customer.phone.ilike(f"%{phone_suffix}"),
                    Customer.whatsapp == phone_number,
                )
            ).limit(1)
        )
        customer = existing_customer.scalar_one_or_none()
        
        if not customer:
            # Try to create customer, handle race condition with IntegrityError
            try:
                customer = Customer(
                    first_name=display_phone,
                    last_name=None,
                    phone=phone_suffix,
                    whatsapp=phone_number,
                )
                self.db.add(customer)
                await self.db.flush()
            except IntegrityError:
                # Race condition - another request created the customer
                await self.db.rollback()
                # Re-query for the customer that was just created
                existing_customer = await self.db.execute(
                    select(Customer).where(
                        or_(
                            Customer.phone == phone_suffix,
                            Customer.phone.ilike(f"%{phone_suffix}"),
                        )
                    ).limit(1)
                )
                customer = existing_customer.scalar_one_or_none()
                if not customer:
                    raise RuntimeError(f"Could not find or create customer for {phone_number}")
        
        # Check if a lead already exists for this customer in this dealership
        existing_lead = await self.db.execute(
            select(Lead).where(
                Lead.customer_id == customer.id,
                Lead.dealership_id == dealership_id,
            ).order_by(Lead.updated_at.desc()).limit(1)
        )
        lead = existing_lead.scalar_one_or_none()
        
        if lead:
            # Lead already exists, return it (not a new lead)
            return customer, lead
        
        # Get default stage for this dealership
        try:
            default_stage = await LeadStageService.get_default_stage(self.db, dealership_id)
        except RuntimeError:
            from app.models.lead_stage import LeadStage
            result = await self.db.execute(
                select(LeadStage)
                .where(LeadStage.dealership_id == dealership_id)
                .order_by(LeadStage.position)
                .limit(1)
            )
            default_stage = result.scalar_one_or_none()
            if not default_stage:
                raise RuntimeError(f"No lead stages found for dealership {dealership_id}")
        
        # Create lead - unassigned so it goes to pool
        lead = Lead(
            customer_id=customer.id,
            dealership_id=dealership_id,
            stage_id=default_stage.id,
            source=LeadSource.WHATSAPP_INBOUND,
            is_active=True,
            interest_score=50,
            assigned_to=None,  # Goes to Unassigned Pool
            notes=f"Auto-created from WhatsApp inbound message",
        )
        self.db.add(lead)
        await self.db.flush()
        
        return customer, lead

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
        return res.scalar_one_or_none()

    async def get_session_window_state(
        self, lead_id: UUID
    ) -> Tuple[bool, Optional[datetime]]:
        """Whether the lead is in the 24h session window, plus last inbound time (single DB read)."""
        last_inbound_at = await self.get_last_inbound_at(lead_id)
        now = utc_now()
        within_window = (
            last_inbound_at is not None
            and (now - last_inbound_at) <= timedelta(hours=24)
        )
        return within_window, last_inbound_at

    async def is_within_whatsapp_session_window(self, lead_id: UUID) -> bool:
        """True if free-form (session) messages are allowed for this lead per last inbound + 24h."""
        within, _ = await self.get_session_window_state(lead_id)
        return within

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
                Customer.whatsapp,
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
            wa, first_name, last_name, phone, whatsapp, unread_count = row
            # Use whatsapp field (full E.164) if available, otherwise phone
            lead_phone = whatsapp or phone
            conversations.append({
                "lead_id": str(wa.lead_id),
                "customer_id": str(wa.customer_id) if wa.customer_id else None,
                "lead_name": f"{first_name or ''} {last_name or ''}".strip() or "Unknown",
                "lead_phone": lead_phone,
                "last_message": {
                    "id": str(wa.id),
                    "body": wa.body,
                    "direction": wa.direction.value,
                    "created_at": wa.created_at.isoformat(),
                    "status": wa.status.value,
                    "media_urls": wa.media_urls or [],
                    "media_content_types": wa.media_content_types or [],
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

    # ==================== Unknown Conversations ====================
    
    async def get_unknown_conversations_list(
        self,
        dealership_id: Optional[UUID] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List WhatsApp conversations from unknown numbers (no lead_id).
        
        Groups messages by contact phone number (from_number for inbound, to_number for outbound)
        and returns the latest message for each conversation.
        """
        # We need to find unique phone numbers that have messages with lead_id=NULL
        # For inbound messages, the contact's phone is in from_number
        # For outbound messages, the contact's phone is in to_number
        
        # Get all unknown messages
        base_query = select(WhatsAppLog).where(WhatsAppLog.lead_id.is_(None))
        if dealership_id:
            base_query = base_query.where(WhatsAppLog.dealership_id == dealership_id)
        
        result = await self.db.execute(base_query.order_by(WhatsAppLog.created_at.desc()))
        all_messages = result.scalars().all()
        
        # Group by contact phone number
        conversations_map: Dict[str, Dict[str, Any]] = {}
        
        for msg in all_messages:
            # Determine the contact's phone number based on direction
            if msg.direction == WhatsAppDirection.INBOUND:
                contact_phone = msg.from_number
            else:
                contact_phone = msg.to_number
            
            # Normalize phone for grouping
            normalized = "".join(c for c in contact_phone if c.isdigit())
            phone_key = normalized[-10:] if len(normalized) >= 10 else normalized
            
            if phone_key not in conversations_map:
                # First (newest) message for this contact
                unread = 1 if (msg.direction == WhatsAppDirection.INBOUND and not msg.is_read) else 0
                conversations_map[phone_key] = {
                    "phone_number": contact_phone,
                    "display_name": self._format_phone_display(contact_phone),
                    "last_message": {
                        "id": str(msg.id),
                        "body": msg.body,
                        "direction": msg.direction.value,
                        "created_at": msg.created_at.isoformat() if msg.created_at else None,
                        "status": msg.status.value if msg.status else "unknown",
                        "media_urls": msg.media_urls or [],
                        "media_content_types": msg.media_content_types or [],
                    },
                    "unread_count": unread,
                    "dealership_id": str(msg.dealership_id) if msg.dealership_id else None,
                }
            else:
                # Count unread for this contact
                if msg.direction == WhatsAppDirection.INBOUND and not msg.is_read:
                    conversations_map[phone_key]["unread_count"] += 1
        
        # Convert to list and apply limit/offset
        conversations = list(conversations_map.values())
        return conversations[offset:offset + limit]
    
    def _format_phone_display(self, phone: str) -> str:
        """Format phone number for display (e.g., +1 (555) 123-4567)."""
        digits = "".join(c for c in phone if c.isdigit())
        if len(digits) == 10:
            return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        elif len(digits) == 11 and digits[0] == "1":
            return f"+1 ({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
        elif len(digits) >= 10:
            # International format
            return f"+{digits[:-10]} {digits[-10:-7]} {digits[-7:-4]} {digits[-4:]}"
        return phone
    
    async def get_unknown_conversation_messages(
        self,
        phone_number: str,
        dealership_id: Optional[UUID] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get all messages for an unknown conversation by phone number."""
        # Normalize phone for matching
        normalized = "".join(c for c in phone_number if c.isdigit())
        suffix = normalized[-10:] if len(normalized) >= 10 else normalized
        
        query = (
            select(WhatsAppLog)
            .where(
                WhatsAppLog.lead_id.is_(None),
                or_(
                    WhatsAppLog.from_number.ilike(f"%{suffix}"),
                    WhatsAppLog.to_number.ilike(f"%{suffix}"),
                )
            )
        )
        if dealership_id:
            query = query.where(WhatsAppLog.dealership_id == dealership_id)
        
        query = query.order_by(WhatsAppLog.created_at.asc()).offset(offset).limit(limit)
        result = await self.db.execute(query)
        messages = result.scalars().all()
        
        return [
            {
                "id": str(m.id),
                "direction": m.direction.value,
                "from_number": m.from_number,
                "to_number": m.to_number,
                "body": m.body,
                "status": m.status.value,
                "is_read": m.is_read,
                "created_at": m.created_at.isoformat(),
                "sent_at": m.sent_at.isoformat() if m.sent_at else None,
                "delivered_at": m.delivered_at.isoformat() if m.delivered_at else None,
                "media_urls": m.media_urls or [],
                "media_content_types": m.media_content_types or [],
            }
            for m in messages
        ]
    
    async def get_unknown_unread_count(
        self,
        dealership_id: Optional[UUID] = None
    ) -> int:
        """Total unread count for unknown conversations."""
        q = select(func.count(func.distinct(WhatsAppLog.id))).where(
            WhatsAppLog.lead_id.is_(None),
            WhatsAppLog.is_read == False,
            WhatsAppLog.direction == literal_column("'inbound'::whatsappdirection")
        )
        if dealership_id:
            q = q.where(WhatsAppLog.dealership_id == dealership_id)
        res = await self.db.execute(q)
        return res.scalar() or 0
    
    async def mark_unknown_conversation_as_read(
        self,
        phone_number: str,
        dealership_id: Optional[UUID] = None
    ) -> int:
        """Mark all messages from an unknown phone number as read."""
        normalized = "".join(c for c in phone_number if c.isdigit())
        suffix = normalized[-10:] if len(normalized) >= 10 else normalized
        
        query = (
            select(WhatsAppLog)
            .where(
                WhatsAppLog.lead_id.is_(None),
                WhatsAppLog.is_read == False,
                WhatsAppLog.from_number.ilike(f"%{suffix}"),
            )
        )
        if dealership_id:
            query = query.where(WhatsAppLog.dealership_id == dealership_id)
        
        result = await self.db.execute(query)
        messages = result.scalars().all()
        
        count = 0
        now = utc_now()
        for msg in messages:
            msg.is_read = True
            msg.read_at = now
            count += 1
        
        if count > 0:
            await self.db.flush()
        
        return count
    
    async def create_lead_from_unknown(
        self,
        phone_number: str,
        dealership_id: UUID,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        email: Optional[str] = None,
        notes: Optional[str] = None,
        assigned_to: Optional[UUID] = None,
    ) -> Tuple[Customer, Lead]:
        """Create a new Customer and Lead from an unknown WhatsApp contact.
        
        Also links all existing messages from this number to the new lead.
        """
        normalized = "".join(c for c in phone_number if c.isdigit())
        display_phone = self._format_phone_display(phone_number)
        
        # Create customer
        customer = Customer(
            first_name=first_name or display_phone,
            last_name=last_name,
            email=email,
            phone=normalized[-10:] if len(normalized) >= 10 else normalized,
            whatsapp=phone_number,
        )
        self.db.add(customer)
        await self.db.flush()
        
        # Get default stage
        try:
            default_stage = await LeadStageService.get_default_stage(self.db, dealership_id)
        except RuntimeError:
            from app.models.lead_stage import LeadStage
            result = await self.db.execute(
                select(LeadStage)
                .where(LeadStage.dealership_id == dealership_id)
                .order_by(LeadStage.position)
                .limit(1)
            )
            default_stage = result.scalar_one_or_none()
            if not default_stage:
                raise RuntimeError(f"No lead stages found for dealership {dealership_id}")
        
        # Create lead
        lead = Lead(
            customer_id=customer.id,
            dealership_id=dealership_id,
            stage_id=default_stage.id,
            source=LeadSource.WHATSAPP_INBOUND,
            is_active=True,
            interest_score=50,
            notes=notes or f"Created from WhatsApp contact {phone_number}",
            assigned_to=assigned_to,
        )
        self.db.add(lead)
        await self.db.flush()
        
        # Link all existing messages from this number to the new lead
        linked_count = await self.link_unknown_messages_to_lead(
            phone_number=phone_number,
            lead_id=lead.id,
            customer_id=customer.id,
            dealership_id=dealership_id,
        )
        
        logger.info(f"Created lead {lead.id} from unknown contact {phone_number}, linked {linked_count} messages")
        
        return customer, lead

    async def link_unknown_messages_to_lead(
        self,
        phone_number: str,
        lead_id: UUID,
        customer_id: UUID,
        dealership_id: UUID,
    ) -> int:
        """Link all unknown messages from a phone number to an existing lead.
        
        Returns the number of messages linked.
        """
        normalized = "".join(c for c in phone_number if c.isdigit())
        suffix = normalized[-10:] if len(normalized) >= 10 else normalized
        
        query = (
            select(WhatsAppLog)
            .where(
                WhatsAppLog.lead_id.is_(None),
                WhatsAppLog.dealership_id == dealership_id,
                or_(
                    WhatsAppLog.from_number.ilike(f"%{suffix}"),
                    WhatsAppLog.to_number.ilike(f"%{suffix}"),
                )
            )
        )
        result = await self.db.execute(query)
        messages = result.scalars().all()
        
        for msg in messages:
            msg.lead_id = lead_id
            msg.customer_id = customer_id
        
        await self.db.flush()
        logger.info(f"Linked {len(messages)} messages from {phone_number} to lead {lead_id}")
        
        return len(messages)


def get_whatsapp_conversation_service(db: AsyncSession) -> WhatsAppConversationService:
    return WhatsAppConversationService(db)
