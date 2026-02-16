"""
Twilio Voice Service - WebRTC Softphone Integration
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import UUID

from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.user import User
from app.models.activity import Activity, ActivityType

logger = logging.getLogger(__name__)


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
        self._twilio_client = None
    
    @property
    def is_configured(self) -> bool:
        """Check if Twilio Voice is properly configured"""
        return settings.is_twilio_voice_configured
    
    def _get_twilio_client(self):
        """Get or create Twilio client"""
        if self._twilio_client is None:
            try:
                from twilio.rest import Client
                self._twilio_client = Client(
                    settings.twilio_account_sid,
                    settings.twilio_auth_token
                )
            except ImportError:
                logger.error("Twilio package not installed. Run: pip install twilio")
                raise
        return self._twilio_client
    
    def generate_access_token(
        self,
        user_id: UUID,
        identity: str,
        ttl: int = 3600
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
        if not self.is_configured:
            raise ValueError("Twilio Voice not configured")
        
        try:
            from twilio.jwt.access_token import AccessToken
            from twilio.jwt.access_token.grants import VoiceGrant
            
            # Create access token
            token = AccessToken(
                settings.twilio_account_sid,
                settings.twilio_api_key_sid,
                settings.twilio_api_key_secret,
                identity=identity,
                ttl=ttl
            )
            
            # Create voice grant
            voice_grant = VoiceGrant(
                outgoing_application_sid=settings.twilio_twiml_app_sid,
                incoming_allow=True  # Allow incoming calls
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
        
        # Create activity
        await ActivityService.log_activity(
            db=self.db,
            activity_type=ActivityType.CALL_LOGGED,
            description=description,
            user_id=call_log.user_id,
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
                "outcome": call_log.outcome
            }
        )
        
        call_log.activity_logged = True
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
        """
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
        if not activity:
            logger.debug(f"No CALL_LOGGED activity found for call_log_id {call_log_id}")
            return
        meta = dict(activity.meta_data or {})
        meta["recording_url"] = recording_url
        if recording_sid is not None:
            meta["recording_sid"] = recording_sid
        if recording_duration_seconds is not None:
            meta["recording_duration_seconds"] = recording_duration_seconds
        activity.meta_data = meta
        await self.db.flush()
        logger.info(f"Updated activity with recording for call_log {call_log_id}")
    
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
    ) -> Optional[CallLog]:
        """
        Create call_log with real Twilio CallSid when outgoing webhook runs.
        This is the only place outbound call_log rows are created (no pending SIDs).
        """
        identity = self._normalize_identity(from_identity)
        result = await self.db.execute(
            select(User).where(User.email == identity).limit(1)
        )
        user = result.scalar_one_or_none()
        if not user:
            return None
        lead = await self.find_lead_by_phone(to_number)
        dealership_id = user.dealership_id or (lead.dealership_id if lead else None)
        call_log = await self.create_call_log(
            twilio_call_sid=call_sid,
            direction=CallDirection.OUTBOUND,
            from_number=settings.twilio_phone_number,
            to_number=to_number,
            user_id=user.id,
            lead_id=lead.id if lead else None,
            customer_id=lead.customer_id if lead else None,
            dealership_id=dealership_id,
            status=CallStatus.INITIATED,
        )
        logger.info(f"Created call_log {call_log.id} for outgoing call {call_sid} (no pending found)")
        return call_log

    def generate_twiml_for_outbound(
        self,
        to_number: str,
        caller_id: Optional[str] = None,
        record: bool = True
    ) -> str:
        """Generate TwiML for outbound call"""
        from twilio.twiml.voice_response import VoiceResponse, Dial

        base = settings.backend_url.rstrip("/")
        status_url = f"{base}/api/v1/voice/webhook/status"
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        response = VoiceResponse()
        dial = Dial(
            caller_id=caller_id or settings.twilio_phone_number,
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
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        response = VoiceResponse()
        dial = Dial(
            record="record-from-answer-dual" if record else "do-not-record",
            action=status_url,
            method="POST",
            recording_status_callback=recording_url,
            recording_status_callback_event="completed",
        )
        dial.client(client_identity)
        response.append(dial)

        return str(response)
    
    def generate_twiml_voicemail(self, message: str = "Please leave a message after the beep.") -> str:
        """Generate TwiML for voicemail"""
        from twilio.twiml.voice_response import VoiceResponse
        
        response = VoiceResponse()
        response.say(message)
        response.record(
            max_length=120,
            transcribe=True,
            play_beep=True
        )
        response.hangup()
        
        return str(response)


# Factory function for creating service instances
def get_voice_service(db: AsyncSession) -> VoiceService:
    return VoiceService(db)
