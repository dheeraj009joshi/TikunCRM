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
from app.core.permissions import UserRole
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.lead import Lead
from app.services.lead_stage_service import LeadStageService
from app.models.customer import Customer
from app.models.user import User
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

    async def find_users_for_incoming_call(
        self,
        lead: Optional[Lead],
        dealership_id: Optional[UUID] = None
    ) -> Tuple[List[User], bool]:
        """
        Find users to ring for an incoming call (ring group support).
        
        Returns:
            Tuple of (list_of_users_to_ring, is_unknown_caller)
            - If lead has assigned_to: ring only that user
            - If lead unassigned or unknown caller: ring all active salespersons in dealership
        """
        is_unknown_caller = lead is None
        
        # If lead has an assigned user, ring only them
        if lead and lead.assigned_to:
            result = await self.db.execute(
                select(User).where(
                    User.id == lead.assigned_to,
                    User.is_active == True
                )
            )
            user = result.scalar_one_or_none()
            if user:
                return ([user], is_unknown_caller)
        
        # Ring all active salespersons in the dealership
        target_dealership = dealership_id or (lead.dealership_id if lead else None)
        if target_dealership:
            result = await self.db.execute(
                select(User).where(
                    User.dealership_id == target_dealership,
                    User.is_active == True,
                    User.role.in_([UserRole.SALESPERSON, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER])
                )
            )
            users = list(result.scalars().all())
            if users:
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
        Auto-assign lead to user who answered if not already assigned.
        Only salespersons can be auto-assigned leads - admins and owners are excluded.
        Returns True if assignment was made.
        """
        if not call_log.lead_id:
            return False
        
        # Only salespersons can be auto-assigned leads via call answer
        # Admins, owners, and super admins should NEVER be auto-assigned leads
        role_val = answered_by_user.role.value if hasattr(answered_by_user.role, 'value') else str(answered_by_user.role)
        if (
            answered_by_user.role != UserRole.SALESPERSON
            or role_val != "salesperson"
            or role_val in _AUTO_ASSIGN_BLOCKED_ROLES
        ):
            logger.warning(
                f"BLOCKED auto-assign on call: {answered_by_user.email} has role={role_val} (raw: {answered_by_user.role!r}), only SALESPERSON can be auto-assigned"
            )
            return False
        
        result = await self.db.execute(
            select(Lead).where(Lead.id == call_log.lead_id)
        )
        lead = result.scalar_one_or_none()
        
        if not lead:
            return False
        
        # Only assign if lead is currently unassigned
        if lead.assigned_to:
            return False
        
        lead.assigned_to = answered_by_user.id
        await self.db.flush()
        
        # Log activity for assignment
        from app.services.activity import ActivityService
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
            }
        )
        
        logger.info(f"Auto-assigned lead {lead.id} to user {answered_by_user.id} via call answer")
        return True

    async def get_user_by_identity(self, identity: str) -> Optional[User]:
        """Get user by email (identity used in Twilio client)."""
        normalized = self._normalize_identity(identity)
        if not normalized:
            return None
        result = await self.db.execute(
            select(User).where(User.email == normalized).limit(1)
        )
        return result.scalar_one_or_none()
    
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

    def generate_twiml_ring_group(
        self,
        user_identities: List[str],
        timeout: int = 30,
        record: bool = True
    ) -> str:
        """
        Generate TwiML for ring group - rings multiple WebRTC clients simultaneously.
        First person to answer gets the call.
        Falls back to voicemail if no one answers.
        """
        from twilio.twiml.voice_response import VoiceResponse, Dial

        base = settings.backend_url.rstrip("/")
        status_url = f"{base}/api/v1/voice/webhook/status"
        recording_url = f"{base}/api/v1/voice/webhook/recording"

        response = VoiceResponse()
        
        if not user_identities:
            # No one to ring - go straight to voicemail
            response.say("Sorry, no one is available to take your call. Please leave a message after the beep.")
            response.record(
                max_length=120,
                transcribe=True,
                play_beep=True
            )
            response.hangup()
            return str(response)
        
        dial = Dial(
            timeout=timeout,
            record="record-from-answer-dual" if record else "do-not-record",
            action=status_url,
            method="POST",
            recording_status_callback=recording_url,
            recording_status_callback_event="completed",
        )
        
        # Add all clients to dial simultaneously
        for identity in user_identities:
            dial.client(identity)
        
        response.append(dial)
        
        # Fallback if no one answers (Dial action handles this)
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
                return
            
            try:
                # Download from Twilio and upload to Azure
                filename = f"call_{call_sid}_{recording_sid}.wav"
                twilio_wav_url = f"{recording_url}.wav"
                
                azure_url = await azure_storage_service.upload_recording_from_url(
                    source_url=twilio_wav_url,
                    filename=filename,
                    auth=(settings.twilio_account_sid, settings.twilio_auth_token),
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
