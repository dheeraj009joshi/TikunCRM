"""
Twilio Voice Service - WebRTC Softphone Integration
"""
import logging
import traceback
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from uuid import UUID

from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.timezone import utc_now
from app.services.dealership_twilio_config_service import (
    EffectiveTwilioConfig,
    get_effective_twilio_config,
)
from app.core.permissions import UserRole
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.lead import Lead
from app.services.lead_stage_service import LeadStageService
from app.models.customer import Customer
from app.models.user import User
from app.models.user_dealership_access import UserDealershipAccess
from app.models.activity import Activity, ActivityType

logger = logging.getLogger(__name__)

# Roles that must NEVER receive auto-assignment on call answer (only salespersons can)
_AUTO_ASSIGN_BLOCKED_ROLES = frozenset({
    UserRole.SUPER_ADMIN.value,
    UserRole.DEALERSHIP_OWNER.value,
    UserRole.DEALERSHIP_ADMIN.value,
})


class VoiceService:
    """
    Service for Twilio Voice integration.
    Handles WebRTC softphone, call management, and recording uploads.
    
    Usage:
        service = VoiceService(db)
        token = await service.generate_access_token(user_id, "user@example.com")
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db

    def _get_twilio_client(self, effective: EffectiveTwilioConfig):
        """Twilio REST client for this dealership's credentials."""
        try:
            from twilio.rest import Client
            return Client(effective.account_sid, effective.auth_token)
        except ImportError:
            logger.error("Twilio package not installed. Run: pip install twilio")
            raise

    def generate_access_token(
        self,
        user_id: UUID,
        identity: str,
        effective: EffectiveTwilioConfig,
        ttl: int = 3600,
    ) -> str:
        """
        Generate a Twilio Access Token for WebRTC client.
        
        Args:
            user_id: User ID (used for logging)
            identity: Unique identity for the client (usually email or user ID)
            ttl: Token time-to-live in seconds (default 1 hour)
            
        Returns:
            JWT access token string
        """
        if not effective.is_voice_ready():
            raise ValueError("Twilio Voice not configured")

        try:
            from twilio.jwt.access_token import AccessToken
            from twilio.jwt.access_token.grants import VoiceGrant

            token = AccessToken(
                effective.account_sid,
                effective.twilio_api_key_sid,
                effective.twilio_api_key_secret,
                identity=identity,
                ttl=ttl,
            )

            voice_grant = VoiceGrant(
                outgoing_application_sid=effective.twilio_twiml_app_sid,
                incoming_allow=True,
            )
            
            # Add grant to token
            token.add_grant(voice_grant)
            
            logger.info(f"Generated voice access token for user {user_id} (identity: {identity})")
            return token.to_jwt()
            
        except Exception as e:
            logger.error(f"Failed to generate access token: {e}")
            raise
    
    async def find_lead_by_phone(self, phone: str) -> Optional[Lead]:
        """Find a lead by phone number via Customer table (most recent lead for that customer)."""
        normalized = "".join(c for c in phone if c.isdigit())
        if len(normalized) < 10:
            return None
        suffix = normalized[-10:]
        cust_result = await self.db.execute(
            select(Customer).where(
                or_(
                    Customer.phone.ilike(f"%{suffix}"),
                    Customer.alternate_phone.ilike(f"%{suffix}"),
                )
            ).limit(1)
        )
        customer = cust_result.scalar_one_or_none()
        if not customer:
            return None
        result = await self.db.execute(
            select(Lead)
            .where(Lead.customer_id == customer.id)
            .order_by(Lead.updated_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    async def find_user_for_incoming_call(
        self,
        lead: Optional[Lead],
        dealership_id: Optional[UUID] = None
    ) -> Optional[User]:
        """
        Find the appropriate user to route an incoming call to.
        Priority: assigned user > any available user in dealership
        """
        if lead and lead.assigned_to:
            # Get assigned user
            result = await self.db.execute(
                select(User).where(
                    User.id == lead.assigned_to,
                    User.is_active == True
                )
            )
            user = result.scalar_one_or_none()
            if user:
                return user
        
        # If no assigned user, try to find one in the dealership
        if dealership_id or (lead and lead.dealership_id):
            target_dealership = dealership_id or lead.dealership_id
            result = await self.db.execute(
                select(User).where(
                    User.dealership_id == target_dealership,
                    User.is_active == True
                ).limit(1)
            )
            return result.scalar_one_or_none()
        
        return None

    async def _get_bdc_agents_for_dealership(self, dealership_id: UUID) -> List[User]:
        """Active BDC agents with access to the given dealership."""
        result = await self.db.execute(
            select(User)
            .join(UserDealershipAccess, User.id == UserDealershipAccess.user_id)
            .where(
                User.role == UserRole.BDC,
                User.is_active == True,
                UserDealershipAccess.dealership_id == dealership_id,
            )
            .distinct()
        )
        return list(result.scalars().all())

    @staticmethod
    def client_identity_for_user(user: User) -> str:
        """Twilio Client identity — must match voice token identity (user UUID)."""
        return str(user.id)

    async def find_users_for_incoming_call(
        self,
        lead: Optional[Lead],
        dealership_id: Optional[UUID] = None
    ) -> Tuple[List[User], bool]:
        """
        Find users to ring for an incoming call (ring group support).

        Returns:
            Tuple of (list_of_users_to_ring, is_unknown_caller)

        Ring policy:
            - Assigned lead: assigned salesperson + all BDC agents for the dealership
            - Unassigned / unknown: dealership sales team + all BDC agents for the dealership
        """
        is_unknown_caller = lead is None
        target_dealership = dealership_id or (lead.dealership_id if lead else None)

        users_by_id: Dict[UUID, User] = {}

        # Assigned salesperson (if any)
        if lead and lead.assigned_to:
            result = await self.db.execute(
                select(User).where(
                    User.id == lead.assigned_to,
                    User.is_active == True,
                )
            )
            assigned = result.scalar_one_or_none()
            if assigned:
                users_by_id[assigned.id] = assigned
        elif target_dealership:
            # Unassigned: ring the dealership sales team
            result = await self.db.execute(
                select(User).where(
                    User.dealership_id == target_dealership,
                    User.is_active == True,
                    User.role.in_([
                        UserRole.SALESPERSON,
                        UserRole.DEALERSHIP_ADMIN,
                        UserRole.DEALERSHIP_OWNER,
                    ]),
                )
            )
            for user in result.scalars().all():
                users_by_id[user.id] = user

        # Always include BDC agents with access to this dealership
        if target_dealership:
            for bdc in await self._get_bdc_agents_for_dealership(target_dealership):
                users_by_id[bdc.id] = bdc

        users = list(users_by_id.values())
        if users:
            logger.info(
                "Incoming ring group for dealership %s: %d users (%d BDC)",
                target_dealership,
                len(users),
                sum(1 for u in users if u.role == UserRole.BDC),
            )
            return (users, is_unknown_caller)

        return ([], is_unknown_caller)

    async def find_customer_by_phone(self, phone: str, dealership_id: Optional[UUID] = None) -> Optional[Customer]:
        """Find a customer by phone number."""
        normalized = "".join(c for c in phone if c.isdigit())
        if len(normalized) < 10:
            return None
        suffix = normalized[-10:]
        
        query = select(Customer).where(
            or_(
                Customer.phone.ilike(f"%{suffix}"),
                Customer.alternate_phone.ilike(f"%{suffix}"),
            )
        )
        if dealership_id:
            query = query.where(Customer.dealership_id == dealership_id)
        query = query.limit(1)
        
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create_minimal_lead_for_unknown_caller(
        self,
        phone: str,
        dealership_id: UUID
    ) -> Tuple[Lead, Customer]:
        """
        Create a minimal lead + customer for an unknown caller.
        The lead.requires_lead_details flag is set via call_log.
        """
        # Create customer with phone only
        customer = Customer(
            phone=phone,
            dealership_id=dealership_id,
            first_name="Unknown",
            last_name="Caller",
        )
        self.db.add(customer)
        await self.db.flush()
        
        # Get default stage and create lead with minimal info
        default_stage = await LeadStageService.get_default_stage(self.db, dealership_id)
        lead = Lead(
            customer_id=customer.id,
            dealership_id=dealership_id,
            source="inbound_call",
            stage_id=default_stage.id,
        )
        self.db.add(lead)
        await self.db.flush()
        
        logger.info(f"Created minimal lead {lead.id} for unknown caller {phone}")
        return lead, customer

    async def auto_assign_lead_on_answer(
        self,
        call_log: CallLog,
        answered_by_user: User
    ) -> bool:
        """
        Auto-assign lead when someone answers an inbound call.
        - Salesperson: set assigned_to if currently unassigned
        - BDC: set bdc_assigned_to_id if currently unset
        Admins/owners/super admins are never auto-assigned.
        Returns True if any assignment was made.
        """
        if not call_log.lead_id:
            return False

        role_val = (
            answered_by_user.role.value
            if hasattr(answered_by_user.role, "value")
            else str(answered_by_user.role)
        )
        if role_val in _AUTO_ASSIGN_BLOCKED_ROLES:
            logger.warning(
                "BLOCKED auto-assign on call: %s has role=%s",
                answered_by_user.email,
                role_val,
            )
            return False

        result = await self.db.execute(
            select(Lead).where(Lead.id == call_log.lead_id)
        )
        lead = result.scalar_one_or_none()
        if not lead:
            return False

        from app.services.activity import ActivityService

        # BDC agent answered → claim BDC slot if free
        if answered_by_user.role == UserRole.BDC or role_val == UserRole.BDC.value:
            if lead.bdc_assigned_to_id:
                return False
            lead.bdc_assigned_to_id = answered_by_user.id
            await self.db.flush()
            await ActivityService.log_activity(
                db=self.db,
                activity_type=ActivityType.LEAD_ASSIGNED,
                description=(
                    f"BDC agent auto-assigned to {answered_by_user.full_name} "
                    f"via incoming call"
                ),
                user_id=answered_by_user.id,
                lead_id=lead.id,
                dealership_id=lead.dealership_id,
                meta_data={
                    "call_log_id": str(call_log.id),
                    "assignment_method": "incoming_call_answer_bdc",
                    "bdc_assigned_to_id": str(answered_by_user.id),
                },
            )
            logger.info(
                "Auto-assigned BDC on lead %s to user %s via call answer",
                lead.id,
                answered_by_user.id,
            )
            return True

        # Only salespersons can be auto-assigned as primary salesperson
        if (
            answered_by_user.role != UserRole.SALESPERSON
            or role_val != UserRole.SALESPERSON.value
        ):
            logger.warning(
                "BLOCKED auto-assign on call: %s has role=%s (raw: %r), "
                "only SALESPERSON/BDC can be auto-assigned",
                answered_by_user.email,
                role_val,
                answered_by_user.role,
            )
            return False

        if lead.assigned_to:
            return False

        lead.assigned_to = answered_by_user.id
        lead.clear_returned_to_pool_state()
        await self.db.flush()

        await ActivityService.log_activity(
            db=self.db,
            activity_type=ActivityType.LEAD_ASSIGNED,
            description=f"Lead auto-assigned to {answered_by_user.full_name} via incoming call",
            user_id=answered_by_user.id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
            meta_data={
                "call_log_id": str(call_log.id),
                "assignment_method": "incoming_call_answer",
            },
        )

        logger.info(
            "Auto-assigned lead %s to user %s via call answer",
            lead.id,
            answered_by_user.id,
        )
        return True

    async def get_user_by_identity(self, identity: str) -> Optional[User]:
        """
        Resolve a Twilio client identity to a User.

        New tokens use the user UUID as identity (multi-dealership safe). Older
        tokens issued before that change used the user's email; we fall back to
        an email lookup so in-flight calls during rollout still resolve. Email
        fallback may be ambiguous when the same email exists in multiple
        dealerships, so it is intentionally a last resort.
        """
        normalized = self._normalize_identity(identity)
        if not normalized:
            return None

        try:
            user_uuid = UUID(normalized)
            result = await self.db.execute(
                select(User).where(User.id == user_uuid).limit(1)
            )
            user = result.scalar_one_or_none()
            if user:
                return user
        except (ValueError, TypeError):
            pass

        result = await self.db.execute(
            select(User).where(User.email == normalized).limit(1)
        )
        return result.scalar_one_or_none()

    async def resolve_voice_dealership_id(
        self,
        user: User,
        preferred_dealership_id: Optional[UUID] = None,
        lead: Optional[Lead] = None,
    ) -> Optional[UUID]:
        """
        Resolve which dealership Twilio config to use.

        BDC agents have dealership_id=NULL and use user_dealership_access.
        Prefer: explicit preference → lead.dealership_id → user.dealership_id → first accessible.
        """
        from app.core.access_scope import get_accessible_dealership_ids

        accessible = await get_accessible_dealership_ids(self.db, user)

        candidates: List[UUID] = []
        if preferred_dealership_id:
            candidates.append(preferred_dealership_id)
        if lead and lead.dealership_id:
            candidates.append(lead.dealership_id)
        if user.dealership_id:
            candidates.append(user.dealership_id)

        for candidate in candidates:
            if accessible is None or candidate in accessible:
                return candidate

        if accessible:
            return accessible[0]
        return user.dealership_id

    async def get_call_log_by_sid(
        self,
        call_sid: Optional[str] = None,
        parent_call_sid: Optional[str] = None,
    ) -> Optional[CallLog]:
        """Find call_log by Twilio CallSid or ParentCallSid (ring-group child legs)."""
        if parent_call_sid:
            result = await self.db.execute(
                select(CallLog).where(CallLog.twilio_call_sid == parent_call_sid).limit(1)
            )
            found = result.scalar_one_or_none()
            if found:
                return found
        if call_sid:
            result = await self.db.execute(
                select(CallLog).where(CallLog.twilio_call_sid == call_sid).limit(1)
            )
            found = result.scalar_one_or_none()
            if found:
                return found
            # Child leg may have been stored with parent sid only — try parent column
            result = await self.db.execute(
                select(CallLog).where(CallLog.twilio_parent_call_sid == call_sid).limit(1)
            )
            return result.scalar_one_or_none()
        return None

    async def attribute_answered_user(
        self,
        call_log: CallLog,
        user: User,
        *,
        auto_assign: bool = True,
    ) -> None:
        """Attach answering user to call_log (fixes ring-group user_id=NULL for BDC)."""
        call_log.answered_by = user.id
        if not call_log.user_id:
            call_log.user_id = user.id
        await self.db.flush()
        logger.info(
            "Attributed call_log %s to user %s (%s)",
            call_log.id,
            user.id,
            user.email,
        )
        if auto_assign and call_log.direction == CallDirection.INBOUND:
            await self.auto_assign_lead_on_answer(call_log, user)
    
    async def create_call_log(
        self,
        twilio_call_sid: str,
        direction: CallDirection,
        from_number: str,
        to_number: str,
        user_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        status: CallStatus = CallStatus.INITIATED,
        parent_call_sid: Optional[str] = None
    ) -> CallLog:
        """Create a new call log entry (customer_id for unified history)."""
        call_log = CallLog(
            twilio_call_sid=twilio_call_sid,
            twilio_parent_call_sid=parent_call_sid,
            direction=direction,
            from_number=from_number,
            to_number=to_number,
            user_id=user_id,
            lead_id=lead_id,
            customer_id=customer_id,
            dealership_id=dealership_id,
            status=status,
            started_at=utc_now()
        )
        
        self.db.add(call_log)
        await self.db.flush()
        
        logger.info(f"Created call log: {call_log.id} ({direction.value})")
        return call_log
    
    async def update_call_status(
        self,
        call_sid: str,
        status: CallStatus,
        duration: Optional[int] = None,
        answered_at: Optional[datetime] = None,
        ended_at: Optional[datetime] = None
    ) -> Optional[CallLog]:
        """Update call status from Twilio webhook"""
        result = await self.db.execute(
            select(CallLog).where(CallLog.twilio_call_sid == call_sid)
        )
        call_log = result.scalar_one_or_none()

        if not call_log:
            logger.warning(f"Call log not found for SID: {call_sid}")
            return None

        call_log.status = status
        
        if duration is not None:
            call_log.duration_seconds = duration
        
        if answered_at:
            call_log.answered_at = answered_at
        elif status == CallStatus.IN_PROGRESS and not call_log.answered_at:
            call_log.answered_at = utc_now()
        
        if ended_at:
            call_log.ended_at = ended_at
        elif status in [CallStatus.COMPLETED, CallStatus.BUSY, CallStatus.NO_ANSWER, CallStatus.FAILED, CallStatus.CANCELED]:
            call_log.ended_at = utc_now()
        
        await self.db.flush()
        logger.info(f"Updated call {call_sid} status to {status.value}")
        
        return call_log
    
    async def handle_recording_complete(
        self,
        call_sid: str,
        recording_sid: str,
        recording_url: str,
        recording_duration: int
    ) -> Optional[CallLog]:
        """
        Handle recording completion webhook.
        Downloads recording from Twilio and uploads to Azure.
        """
        result = await self.db.execute(
            select(CallLog).where(CallLog.twilio_call_sid == call_sid)
        )
        call_log = result.scalar_one_or_none()

        if not call_log:
            logger.warning(f"Call log not found for recording: {call_sid}")
            return None

        try:
            # Store Twilio recording URL in DB. Playback uses the proxy endpoint with Twilio auth.
            # Azure upload is skipped for now to avoid SSL/storage issues; can be re-enabled later.
            twilio_recording_url = f"{recording_url}.wav"
            call_log.recording_url = twilio_recording_url
            call_log.recording_sid = recording_sid
            call_log.recording_duration_seconds = recording_duration
            await self.db.flush()
            logger.info(f"Recording stored for call {call_sid} (Twilio URL)")
            return call_log
        except Exception as e:
            logger.error(f"Failed to process recording for call {call_sid}: {e}")
            return None
    
    async def log_call_activity(self, call_log: CallLog) -> None:
        """Create an Activity record for a completed call"""
        if call_log.activity_logged:
            return
        
        from app.services.activity import ActivityService
        
        # Build description
        if call_log.direction == CallDirection.OUTBOUND:
            direction_text = "Outbound call"
        else:
            direction_text = "Inbound call"
        
        duration_text = ""
        if call_log.duration_seconds > 0:
            minutes = call_log.duration_seconds // 60
            seconds = call_log.duration_seconds % 60
            duration_text = f" ({minutes}m {seconds}s)"
        
        status_text = call_log.status.value.replace("-", " ").title()
        description = f"{direction_text} - {status_text}{duration_text}"
        
        if call_log.notes:
            description += f"\nNotes: {call_log.notes}"
        
        # Create activity — prefer answered_by so ring-group / BDC answers are attributed
        activity_user_id = call_log.answered_by or call_log.user_id
        await ActivityService.log_activity(
            db=self.db,
            activity_type=ActivityType.CALL_LOGGED,
            description=description,
            user_id=activity_user_id,
            lead_id=call_log.lead_id,
            dealership_id=call_log.dealership_id,
            meta_data={
                "call_log_id": str(call_log.id),
                "call_sid": call_log.twilio_call_sid,
                "direction": call_log.direction.value,
                "status": call_log.status.value,
                "duration_seconds": call_log.duration_seconds,
                "recording_url": call_log.recording_url,
                "from_number": call_log.from_number,
                "to_number": call_log.to_number,
                "outcome": call_log.outcome,
                "answered_by": str(call_log.answered_by) if call_log.answered_by else None,
            }
        )
        
        call_log.activity_logged = True

        if call_log.lead_id:
            lead_result = await self.db.execute(
                select(Lead).where(Lead.id == call_log.lead_id)
            )
            lead = lead_result.scalar_one_or_none()
            if lead:
                now = utc_now()
                lead.last_activity_at = now
                lead.last_contacted_at = now
                if not lead.first_contacted_at:
                    lead.first_contacted_at = now

        await self.db.flush()
        logger.info(f"Logged activity for call {call_log.id}")

    async def update_call_activity_recording(
        self,
        call_log_id: UUID,
        recording_url: str,
        recording_sid: Optional[str] = None,
        recording_duration_seconds: Optional[int] = None,
    ) -> None:
        """
        Update the CALL_LOGGED activity's meta_data with recording info when recording webhook runs.
        Also marks unanswered inbound recordings as voicemail.
        """
        call_result = await self.db.execute(
            select(CallLog).where(CallLog.id == call_log_id).limit(1)
        )
        call_log = call_result.scalar_one_or_none()

        # Voicemail = recording left after inbound no-answer / busy / failed
        is_voicemail = bool(
            call_log
            and call_log.direction == CallDirection.INBOUND
            and call_log.status in {
                CallStatus.NO_ANSWER,
                CallStatus.BUSY,
                CallStatus.FAILED,
                CallStatus.CANCELED,
            }
        )
        if call_log and is_voicemail:
            call_log.outcome = "voicemail"
            if recording_duration_seconds is not None:
                call_log.recording_duration_seconds = recording_duration_seconds

        result = await self.db.execute(
            select(Activity)
            .where(
                and_(
                    Activity.type == ActivityType.CALL_LOGGED,
                    Activity.meta_data["call_log_id"].astext == str(call_log_id),
                )
            )
            .limit(1)
        )
        activity = result.scalar_one_or_none()
        if activity:
            meta = dict(activity.meta_data or {})
            meta["recording_url"] = recording_url
            if recording_sid is not None:
                meta["recording_sid"] = recording_sid
            if recording_duration_seconds is not None:
                meta["recording_duration_seconds"] = recording_duration_seconds
                meta["duration_seconds"] = recording_duration_seconds
            if is_voicemail:
                meta["outcome"] = "voicemail"
                meta["is_voicemail"] = True
                # Refresh timeline label so agents see voicemail, not bare "No Answer"
                if activity.description and "Voicemail" not in activity.description:
                    activity.description = f"{activity.description} — Voicemail left"
            # Backfill activity user if ring-group answer was attributed after activity create
            if not activity.user_id and call_log and (call_log.answered_by or call_log.user_id):
                activity.user_id = call_log.answered_by or call_log.user_id
            activity.meta_data = meta
            await self.db.flush()
            logger.info(f"Updated activity with recording for call_log {call_log_id}")
        else:
            logger.debug(f"No CALL_LOGGED activity found for call_log_id {call_log_id}")
            await self.db.flush()

        if call_log and is_voicemail:
            await self.notify_inbound_voicemail(call_log)

    async def _call_lead_display_name(self, lead_id: Optional[UUID]) -> Optional[str]:
        if not lead_id:
            return None
        result = await self.db.execute(
            select(Customer.first_name, Customer.last_name)
            .join(Lead, Lead.customer_id == Customer.id)
            .where(Lead.id == lead_id)
            .limit(1)
        )
        row = result.first()
        if not row:
            return None
        name = f"{row[0] or ''} {row[1] or ''}".strip()
        return name or None

    async def notify_missed_inbound_call(self, call_log: CallLog) -> None:
        """Notify dealership + BDC that an inbound ring group timed out."""
        if not call_log.dealership_id:
            return
        try:
            from app.services.notification_service import NotificationService

            lead_name = await self._call_lead_display_name(call_log.lead_id)
            notif = NotificationService(self.db)
            await notif.notify_missed_inbound_call(
                dealership_id=call_log.dealership_id,
                call_log_id=call_log.id,
                from_number=call_log.from_number or "",
                lead_id=call_log.lead_id,
                lead_name=lead_name,
            )
        except Exception as e:
            logger.warning("Missed-call notification failed for %s: %s", call_log.id, e)

    async def notify_inbound_voicemail(self, call_log: CallLog) -> None:
        """Notify dealership + BDC that a voicemail was left."""
        if not call_log.dealership_id:
            return
        try:
            from app.services.notification_service import NotificationService

            lead_name = await self._call_lead_display_name(call_log.lead_id)
            notif = NotificationService(self.db)
            await notif.notify_inbound_voicemail(
                dealership_id=call_log.dealership_id,
                call_log_id=call_log.id,
                from_number=call_log.from_number or "",
                lead_id=call_log.lead_id,
                lead_name=lead_name,
                duration_seconds=call_log.recording_duration_seconds,
            )
        except Exception as e:
            logger.warning("Voicemail notification failed for %s: %s", call_log.id, e)
    
    async def get_call_history(
        self,
        user_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[CallLog]:
        """Get call history with filters"""
        query = select(CallLog)
        
        if user_id:
            query = query.where(CallLog.user_id == user_id)
        if lead_id:
            query = query.where(CallLog.lead_id == lead_id)
        if dealership_id:
            query = query.where(CallLog.dealership_id == dealership_id)
        
        query = query.order_by(CallLog.created_at.desc()).offset(offset).limit(limit)
        
        result = await self.db.execute(query)
        return list(result.scalars().all())
    
    async def get_call_by_sid(self, call_sid: str) -> Optional[CallLog]:
        """Get a call log by Twilio call SID"""
        result = await self.db.execute(
            select(CallLog).where(CallLog.twilio_call_sid == call_sid)
        )
        return result.scalar_one_or_none()

    def _normalize_identity(self, from_identity: str) -> str:
        """Twilio may send 'client:email' or just 'email'."""
        if not from_identity:
            return ""
        s = from_identity.strip()
        if s.lower().startswith("client:"):
            return s[7:].strip()
        return s

    def _normalize_phone_last10(self, phone: str) -> str:
        """Last 10 digits for matching."""
        if not phone:
            return ""
        digits = "".join(c for c in phone if c.isdigit())
        return digits[-10:] if len(digits) >= 10 else digits

    async def ensure_call_log_for_outgoing(
        self,
        call_sid: str,
        from_identity: str,
        to_number: str,
    ) -> Tuple[Optional[CallLog], Optional[EffectiveTwilioConfig]]:
        """
        Create call_log with real Twilio CallSid when outgoing webhook runs.
        Returns (call_log, effective_twilio_config) for TwiML generation.
        """
        user = await self.get_user_by_identity(from_identity)
        if not user:
            return None, None
        lead = await self.find_lead_by_phone(to_number)
        dealership_id = await self.resolve_voice_dealership_id(user, lead=lead)
        effective = await get_effective_twilio_config(self.db, dealership_id)
        caller_num = effective.voice_caller_id_number or effective.sms_from_number
        call_log = await self.create_call_log(
            twilio_call_sid=call_sid,
            direction=CallDirection.OUTBOUND,
            from_number=caller_num,
            to_number=to_number,
            user_id=user.id,
            lead_id=lead.id if lead else None,
            customer_id=lead.customer_id if lead else None,
            dealership_id=dealership_id,
            status=CallStatus.INITIATED,
        )
        logger.info(f"Created call_log {call_log.id} for outgoing call {call_sid} (no pending found)")
        return call_log, effective

    def generate_twiml_for_outbound(
        self,
        to_number: str,
        effective: EffectiveTwilioConfig,
        caller_id: Optional[str] = None,
        record: bool = True,
    ) -> str:
        """Generate TwiML for outbound call"""
        from twilio.twiml.voice_response import VoiceResponse, Dial

        base = settings.backend_url.rstrip("/")
        status_url = f"{base}/api/v1/voice/webhook/status"
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        cid = caller_id or effective.voice_caller_id_number or effective.sms_from_number

        response = VoiceResponse()
        dial = Dial(
            caller_id=cid,
            record="record-from-answer-dual" if record else "do-not-record",
            action=status_url,
            method="POST",
            recording_status_callback=recording_url,
            recording_status_callback_event="completed",
        )
        dial.number(to_number)
        response.append(dial)

        return str(response)

    def generate_twiml_for_incoming(
        self,
        client_identity: str,
        record: bool = True
    ) -> str:
        """Generate TwiML for incoming call - routes to WebRTC client"""
        from twilio.twiml.voice_response import VoiceResponse, Dial

        base = settings.backend_url.rstrip("/")
        status_url = f"{base}/api/v1/voice/webhook/status"
        client_status_url = f"{base}/api/v1/voice/webhook/client-status"
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        response = VoiceResponse()
        dial = Dial(
            record="record-from-answer-dual" if record else "do-not-record",
            action=status_url,
            method="POST",
            recording_status_callback=recording_url,
            recording_status_callback_event="completed",
        )
        dial.client(
            client_identity,
            status_callback=client_status_url,
            status_callback_event="answered completed",
            status_callback_method="POST",
        )
        response.append(dial)

        return str(response)

    def generate_twiml_voicemail(
        self,
        message: str = "Sorry, no one is available to take your call. Please leave a message after the beep.",
    ) -> str:
        """
        Generate TwiML for inbound voicemail.
        Recording is posted to /webhook/recording so it attaches to the same call_log.
        """
        from twilio.twiml.voice_response import VoiceResponse

        base = settings.backend_url.rstrip("/")
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        response = VoiceResponse()
        response.say(message)
        response.record(
            max_length=120,
            play_beep=True,
            timeout=5,
            recording_status_callback=recording_url,
            recording_status_callback_event="completed",
            recording_status_callback_method="POST",
        )
        response.hangup()
        return str(response)

    def generate_twiml_ring_group(
        self,
        user_identities: List[str],
        timeout: int = 30,
        record: bool = True
    ) -> str:
        """
        Generate TwiML for ring group - rings multiple WebRTC clients simultaneously.
        First person to answer gets the call.
        Per-client statusCallback attributes the answerer (critical for BDC user_id).
        If nobody answers, Dial action (/webhook/status) returns voicemail TwiML.
        """
        from twilio.twiml.voice_response import VoiceResponse, Dial

        base = settings.backend_url.rstrip("/")
        status_url = f"{base}/api/v1/voice/webhook/status"
        client_status_url = f"{base}/api/v1/voice/webhook/client-status"
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        response = VoiceResponse()

        if not user_identities:
            return self.generate_twiml_voicemail()

        dial = Dial(
            timeout=timeout,
            record="record-from-answer-dual" if record else "do-not-record",
            action=status_url,
            method="POST",
            recording_status_callback=recording_url,
            recording_status_callback_event="completed",
        )

        for identity in user_identities:
            dial.client(
                identity,
                status_callback=client_status_url,
                status_callback_event="answered completed",
                status_callback_method="POST",
            )

        response.append(dial)
        return str(response)


# Factory function for creating service instances
def get_voice_service(db: AsyncSession) -> VoiceService:
    return VoiceService(db)


async def upload_recording_to_azure_background(
    call_sid: str,
    recording_url: str,
    recording_sid: str,
    recording_duration: int,
) -> None:
    """
    Background task to download recording from Twilio and upload to Azure.
    Creates its own database session (runs outside request context).
    """
    from app.services.azure_storage_service import azure_storage_service
    from app.core.websocket_manager import ws_manager
    
    logger.info(f"Background recording upload started for call {call_sid}")
    
    # Create dedicated engine and session for background task
    engine = create_async_engine(
        settings.database_url,
        poolclass=NullPool,
    )
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    try:
        async with async_session() as db:
            # Find the call log
            result = await db.execute(
                select(CallLog).where(CallLog.twilio_call_sid == call_sid)
            )
            call_log = result.scalar_one_or_none()
            
            if not call_log:
                logger.warning(f"Background upload: call log not found for {call_sid}")
                return
            
            # Update status to uploading
            call_log.recording_upload_status = "uploading"
            await db.commit()
            
            # Check if Azure is configured
            if not azure_storage_service.is_configured:
                logger.warning(
                    "Azure storage not configured (set AZURE_STORAGE_CONNECTION_STRING), keeping Twilio URL for playback"
                )
                call_log.recording_url = f"{recording_url}.wav"
                call_log.recording_sid = recording_sid
                call_log.recording_duration_seconds = recording_duration
                call_log.recording_upload_status = "completed"
                await db.commit()

                service = VoiceService(db)
                await service.update_call_activity_recording(
                    call_log_id=call_log.id,
                    recording_url=call_log.recording_url,
                    recording_sid=recording_sid,
                    recording_duration_seconds=recording_duration,
                )
                await db.commit()
                return
            
            try:
                from app.services.dealership_twilio_config_service import get_effective_twilio_config

                filename = f"call_{call_sid}_{recording_sid}.wav"
                twilio_wav_url = f"{recording_url}.wav"

                eff = await get_effective_twilio_config(db, call_log.dealership_id)
                auth_pair = (eff.account_sid, eff.auth_token)

                azure_url = await azure_storage_service.upload_recording_from_url(
                    source_url=twilio_wav_url,
                    filename=filename,
                    auth=auth_pair,
                    metadata={
                        "call_sid": call_sid,
                        "recording_sid": recording_sid,
                        "duration": str(recording_duration),
                    }
                )
                
                if azure_url:
                    call_log.recording_url = azure_url
                    call_log.recording_upload_status = "completed"
                    logger.info(f"Recording uploaded to Azure: {filename}")
                else:
                    # Fallback to Twilio URL
                    call_log.recording_url = twilio_wav_url
                    call_log.recording_upload_status = "failed"
                    logger.warning(f"Azure upload failed, using Twilio URL for {call_sid}")
                
            except Exception as upload_err:
                logger.error(
                    f"Recording upload error for {call_sid}: {upload_err}\n{traceback.format_exc()}"
                )
                call_log.recording_url = f"{recording_url}.wav"
                call_log.recording_upload_status = "failed"
            
            call_log.recording_sid = recording_sid
            call_log.recording_duration_seconds = recording_duration
            await db.commit()
            
            # Update activity if it exists
            service = VoiceService(db)
            await service.update_call_activity_recording(
                call_log_id=call_log.id,
                recording_url=call_log.recording_url,
                recording_sid=recording_sid,
                recording_duration_seconds=recording_duration,
            )
            await db.commit()
            
            # Notify user via WebSocket that recording is ready
            if call_log.user_id:
                await ws_manager.send_to_user(
                    str(call_log.user_id),
                    {
                        "type": "call:recording_ready",
                        "payload": {
                            "call_log_id": str(call_log.id),
                            "call_sid": call_sid,
                            "recording_url": call_log.recording_url,
                        }
                    }
                )
            
            logger.info(f"Background recording upload completed for {call_sid}")
            
    except Exception as e:
        logger.error(f"Background recording upload failed for {call_sid}: {e}\n{traceback.format_exc()}")
    finally:
        await engine.dispose()
