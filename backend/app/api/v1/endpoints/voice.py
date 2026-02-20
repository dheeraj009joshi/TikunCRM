"""
Voice API Endpoints - Twilio WebRTC Softphone
"""
import logging
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status, Query
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.config import settings
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.lead import Lead
from app.services.voice_service import VoiceService, get_voice_service
from app.core.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Schemas ============

class VoiceTokenResponse(BaseModel):
    """Response for voice access token"""
    token: str
    identity: str
    expires_in: int = 3600


class InitiateCallRequest(BaseModel):
    """Request to initiate an outbound call"""
    to_number: str = Field(..., description="Phone number to call (E.164 format)")
    lead_id: Optional[UUID] = Field(None, description="Optional lead ID to associate with call")


class InitiateCallResponse(BaseModel):
    """Response for call initiation (call_log_id is null until Twilio provides real SID in outgoing webhook)"""
    call_log_id: Optional[UUID] = None
    call_sid: str = "connecting"
    status: str = "initiated"


class CallLogResponse(BaseModel):
    """Call log response"""
    id: UUID
    lead_id: Optional[UUID]
    user_id: Optional[UUID]
    dealership_id: Optional[UUID]
    twilio_call_sid: str
    direction: str
    from_number: str
    to_number: str
    status: str
    started_at: datetime
    answered_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_seconds: int
    recording_url: Optional[str]
    notes: Optional[str]
    outcome: Optional[str]
    created_at: datetime
    
    # Joined data
    lead_name: Optional[str] = None
    user_name: Optional[str] = None
    
    class Config:
        from_attributes = True


class CallLogListResponse(BaseModel):
    """Paginated call log list"""
    items: List[CallLogResponse]
    total: int
    page: int
    page_size: int


class UpdateCallNotesRequest(BaseModel):
    """Update call notes/outcome"""
    notes: Optional[str] = None
    outcome: Optional[str] = None


class UpdateLeadDetailsRequest(BaseModel):
    """Update lead details after call with unknown caller"""
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)


class UpdateLeadDetailsResponse(BaseModel):
    """Response for lead details update"""
    lead_id: UUID
    customer_id: UUID
    message: str


class VoiceConfigResponse(BaseModel):
    """Voice configuration status"""
    voice_enabled: bool
    phone_number: Optional[str] = None
    recording_enabled: bool = True
    azure_storage_configured: bool = False
    missing_credentials: Optional[List[str]] = None  # When voice_enabled is false, list of env var names to set


# ============ Endpoints ============

def _voice_missing_credentials() -> List[str]:
    """Return list of env var names that are missing for voice to be enabled."""
    missing = []
    if not settings.twilio_account_sid:
        missing.append("TWILIO_ACCOUNT_SID")
    if not settings.twilio_auth_token:
        missing.append("TWILIO_AUTH_TOKEN")
    if not settings.twilio_phone_number:
        missing.append("TWILIO_PHONE_NUMBER")
    if not settings.twilio_twiml_app_sid:
        missing.append("TWILIO_TWIML_APP_SID")
    if not settings.twilio_api_key_sid:
        missing.append("TWILIO_API_KEY_SID")
    if not settings.twilio_api_key_secret:
        missing.append("TWILIO_API_KEY_SECRET")
    if not settings.voice_enabled:
        missing.append("VOICE_ENABLED (set to true)")
    return missing


@router.get("/config", response_model=VoiceConfigResponse)
async def get_voice_config(
    current_user: User = Depends(deps.get_current_active_user)
):
    """Get voice configuration status. When voice_enabled is false, missing_credentials lists env vars to set."""
    enabled = settings.is_twilio_voice_configured
    missing = None if enabled else _voice_missing_credentials()
    return VoiceConfigResponse(
        voice_enabled=enabled,
        phone_number=settings.twilio_phone_number if enabled else None,
        recording_enabled=True,
        azure_storage_configured=settings.is_azure_storage_configured,
        missing_credentials=missing,
    )


@router.get("/config/status")
async def get_voice_config_status(
    current_user: User = Depends(deps.get_current_active_user),
):
    """
    Debug: which env vars are set for voice (no values).
    Use this on production to see what is missing when voice_enabled is false.
    """
    return {
        "voice_enabled": settings.is_twilio_voice_configured,
        "checks": {
            "TWILIO_ACCOUNT_SID": bool(settings.twilio_account_sid),
            "TWILIO_AUTH_TOKEN": bool(settings.twilio_auth_token),
            "TWILIO_PHONE_NUMBER": bool(settings.twilio_phone_number),
            "TWILIO_TWIML_APP_SID": bool(settings.twilio_twiml_app_sid),
            "TWILIO_API_KEY_SID": bool(settings.twilio_api_key_sid),
            "TWILIO_API_KEY_SECRET": bool(settings.twilio_api_key_secret),
            "VOICE_ENABLED": settings.voice_enabled,
        },
    }


@router.post("/token", response_model=VoiceTokenResponse)
async def get_voice_token(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a Twilio access token for the WebRTC softphone.
    Token is valid for 1 hour and allows making/receiving calls.
    """
    if not settings.is_twilio_voice_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice calling is not configured"
        )
    
    service = get_voice_service(db)
    
    # Use user email as identity (unique per user)
    identity = current_user.email
    
    try:
        token = service.generate_access_token(
            user_id=current_user.id,
            identity=identity,
            ttl=3600
        )
        
        return VoiceTokenResponse(
            token=token,
            identity=identity,
            expires_in=3600
        )
    except Exception as e:
        logger.error(f"Failed to generate voice token: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate voice token"
        )


@router.post("/call", response_model=InitiateCallResponse)
async def initiate_call(
    request: InitiateCallRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Initiate an outbound call to a phone number.
    The call will be connected through the WebRTC softphone.
    """
    if not settings.is_twilio_voice_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice calling is not configured"
        )
    
    service = get_voice_service(db)
    
    # Validate phone number format
    from app.services.sms_service import SMSService
    sms = SMSService()
    formatted_number = sms.format_phone_number(request.to_number)
    if not formatted_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number format"
        )
    
    # Get lead info if provided
    lead = None
    dealership_id = current_user.dealership_id
    
    if request.lead_id:
        result = await db.execute(
            select(Lead).where(Lead.id == request.lead_id)
        )
        lead = result.scalar_one_or_none()
        if lead:
            dealership_id = lead.dealership_id or dealership_id
    else:
        # Try to find lead by phone number
        lead = await service.find_lead_by_phone(formatted_number)
    
    # Do not create call_log here; it is created in the outgoing webhook when Twilio sends the real CallSid.
    return InitiateCallResponse(
        call_log_id=None,
        call_sid="connecting",
        status="initiated"
    )


@router.get("/calls", response_model=CallLogListResponse)
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    lead_id: Optional[UUID] = None,
    customer_id: Optional[UUID] = None,
    direction: Optional[str] = None,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List call history.
    - Salespersons see only their calls
    - Admins see all dealership calls
    - Super admins see all calls
    - Pass customer_id to get all calls for that customer (full history); access is checked via lead.
    """
    query = select(CallLog)
    count_query = select(func.count(CallLog.id))

    # Optional: filter by customer for full customer-level call history
    if customer_id:
        # Verify user has access to at least one lead for this customer
        lead_check = select(Lead.id).where(Lead.customer_id == customer_id)
        if current_user.role == UserRole.SALESPERSON:
            lead_check = lead_check.where(Lead.assigned_to == current_user.id)
        elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and current_user.dealership_id:
            lead_check = lead_check.where(Lead.dealership_id == current_user.dealership_id)
        lead_check = lead_check.limit(1)
        access = await db.execute(lead_check)
        if not access.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this customer")
        query = query.where(CallLog.customer_id == customer_id)
        count_query = count_query.where(CallLog.customer_id == customer_id)
    # Apply role-based filtering (always)
    if current_user.role == UserRole.SALESPERSON:
        query = query.where(CallLog.user_id == current_user.id)
        count_query = count_query.where(CallLog.user_id == current_user.id)
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if current_user.dealership_id:
            query = query.where(CallLog.dealership_id == current_user.dealership_id)
            count_query = count_query.where(CallLog.dealership_id == current_user.dealership_id)

    # Apply filters
    if lead_id:
        query = query.where(CallLog.lead_id == lead_id)
        count_query = count_query.where(CallLog.lead_id == lead_id)
    
    if direction:
        try:
            dir_enum = CallDirection(direction)
            query = query.where(CallLog.direction == dir_enum)
            count_query = count_query.where(CallLog.direction == dir_enum)
        except ValueError:
            pass
    
    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Get paginated results with relationships
    query = query.options(
        selectinload(CallLog.lead),
        selectinload(CallLog.user)
    ).order_by(CallLog.created_at.desc())
    
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    
    result = await db.execute(query)
    calls = result.scalars().all()
    
    # Build response
    items = []
    for call in calls:
        item = CallLogResponse(
            id=call.id,
            lead_id=call.lead_id,
            user_id=call.user_id,
            dealership_id=call.dealership_id,
            twilio_call_sid=call.twilio_call_sid,
            direction=call.direction.value,
            from_number=call.from_number,
            to_number=call.to_number,
            status=call.status.value,
            started_at=call.started_at,
            answered_at=call.answered_at,
            ended_at=call.ended_at,
            duration_seconds=call.duration_seconds,
            recording_url=call.recording_url,
            notes=call.notes,
            outcome=call.outcome,
            created_at=call.created_at,
            lead_name=call.lead.full_name if call.lead else None,
            user_name=call.user.full_name if call.user else None
        )
        items.append(item)
    
    return CallLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/calls/{call_id}", response_model=CallLogResponse)
async def get_call(
    call_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Get a specific call log"""
    query = select(CallLog).where(CallLog.id == call_id).options(
        selectinload(CallLog.lead),
        selectinload(CallLog.user)
    )
    
    result = await db.execute(query)
    call = result.scalar_one_or_none()
    
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found"
        )
    
    # Check access
    if current_user.role == UserRole.SALESPERSON and call.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if current_user.dealership_id and call.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    return CallLogResponse(
        id=call.id,
        lead_id=call.lead_id,
        user_id=call.user_id,
        dealership_id=call.dealership_id,
        twilio_call_sid=call.twilio_call_sid,
        direction=call.direction.value,
        from_number=call.from_number,
        to_number=call.to_number,
        status=call.status.value,
        started_at=call.started_at,
        answered_at=call.answered_at,
        ended_at=call.ended_at,
        duration_seconds=call.duration_seconds,
        recording_url=call.recording_url,
        notes=call.notes,
        outcome=call.outcome,
        created_at=call.created_at,
        lead_name=call.lead.full_name if call.lead else None,
        user_name=call.user.full_name if call.user else None
    )


@router.patch("/calls/{call_id}")
async def update_call_notes(
    call_id: UUID,
    request: UpdateCallNotesRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Update call notes and outcome"""
    result = await db.execute(
        select(CallLog).where(CallLog.id == call_id)
    )
    call = result.scalar_one_or_none()
    
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found"
        )
    
    # Check access
    if current_user.role == UserRole.SALESPERSON and call.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if request.notes is not None:
        call.notes = request.notes
    if request.outcome is not None:
        call.outcome = request.outcome
    
    await db.commit()
    
    return {"message": "Call updated successfully"}


@router.post("/calls/{call_id}/update-lead-details", response_model=UpdateLeadDetailsResponse)
async def update_lead_details_from_call(
    call_id: UUID,
    request: UpdateLeadDetailsRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update lead details after a call with an unknown caller.
    This is called when the salesperson completes a call and needs to add 
    the caller's name/email to the auto-created lead.
    """
    from app.models.customer import Customer
    
    result = await db.execute(
        select(CallLog).where(CallLog.id == call_id)
    )
    call = result.scalar_one_or_none()
    
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found"
        )
    
    # Check access - only the user who answered or admins can update
    can_access = (
        current_user.role in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]
        or call.answered_by == current_user.id
        or call.user_id == current_user.id
    )
    if not can_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if not call.lead_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No lead associated with this call"
        )
    
    # Get the lead
    lead_result = await db.execute(
        select(Lead).where(Lead.id == call.lead_id)
    )
    lead = lead_result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lead not found"
        )
    
    # Update the customer with the provided details
    if lead.customer_id:
        customer_result = await db.execute(
            select(Customer).where(Customer.id == lead.customer_id)
        )
        customer = customer_result.scalar_one_or_none()
        
        if customer:
            customer.first_name = request.first_name
            customer.last_name = request.last_name
            if request.email:
                customer.email = request.email
    
    # Clear the requires_lead_details flag
    call.requires_lead_details = False
    
    await db.commit()
    
    logger.info(f"Updated lead details for call {call_id}: {request.first_name} {request.last_name}")
    
    return UpdateLeadDetailsResponse(
        lead_id=lead.id,
        customer_id=lead.customer_id,
        message="Lead details updated successfully"
    )


@router.get("/calls/{call_id}/recording-url")
async def get_recording_url(
    call_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a secure, time-limited URL for call recording playback.
    URL expires after 1 hour for security.
    """
    result = await db.execute(
        select(CallLog).where(CallLog.id == call_id)
    )
    call = result.scalar_one_or_none()
    
    if not call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call not found"
        )
    
    # Check access
    if current_user.role == UserRole.SALESPERSON and call.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if not call.recording_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No recording available for this call"
        )
    
    # If it's an Azure URL, generate a fresh SAS URL (playable in browser)
    from app.services.azure_storage_service import azure_storage_service
    
    if azure_storage_service.is_configured and "blob.core.windows.net" in call.recording_url:
        # Extract blob name from URL
        blob_name = call.recording_url.split("/")[-1].split("?")[0]
        secure_url = azure_storage_service.get_secure_url(blob_name, expiry_hours=1)
        if secure_url:
            return {"recording_url": secure_url, "expires_in": 3600}
    
    # Twilio recording URLs require Basic auth; return our proxy URL so frontend can fetch with Bearer
    if "api.twilio.com" in call.recording_url:
        base = settings.backend_url.rstrip("/")
        proxy_url = f"{base}/api/v1/voice/calls/{call_id}/recording"
        return {"recording_url": proxy_url, "expires_in": 3600}
    
    # Fallback: return the stored URL directly
    return {"recording_url": call.recording_url, "expires_in": None}


@router.get("/calls/{call_id}/recording")
async def stream_recording(
    call_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream call recording (for Twilio URLs that require auth).
    Frontend fetches this URL with Bearer token and uses the response as blob for playback.
    """
    result = await db.execute(
        select(CallLog).where(CallLog.id == call_id)
    )
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Call not found")
    if current_user.role == UserRole.SALESPERSON and call.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if not call.recording_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No recording available")

    if "api.twilio.com" in call.recording_url:
        import httpx
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    call.recording_url,
                    auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                    follow_redirects=True,
                )
                r.raise_for_status()
                media_type = r.headers.get("content-type", "audio/wav")
                return Response(content=r.content, media_type=media_type)
        except Exception as e:
            logger.warning(f"Failed to fetch Twilio recording for {call_id}: {e}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to load recording")

    # Azure or other: redirect not needed here; get_recording_url returns SAS for Azure
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use recording-url endpoint for this recording")


# ============ Twilio Webhooks ============

@router.post("/webhook/incoming", response_class=PlainTextResponse)
async def handle_incoming_call(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for incoming calls.
    Routes call to appropriate user(s) WebRTC client(s).
    
    Ring rules:
    - If caller is known and lead is assigned: ring only assigned user
    - If caller is known but lead unassigned: ring all salespersons (first to answer gets assigned)
    - If caller is unknown: create minimal lead, ring all salespersons
    """
    form_data = await request.form()
    
    call_sid = form_data.get("CallSid", "")
    from_number = form_data.get("From", "")
    to_number = form_data.get("To", "")
    
    logger.info(f"Incoming call webhook: {call_sid} from {from_number} to {to_number}")
    
    service = get_voice_service(db)
    
    # Try to find the lead by phone number
    lead = await service.find_lead_by_phone(from_number)
    is_unknown_caller = lead is None
    requires_lead_details = False
    
    # Determine dealership from Twilio phone number config or use default
    # For now, we'll get dealership from lead or first available user
    dealership_id = lead.dealership_id if lead else None
    
    # If unknown caller, we need a dealership to create the lead
    # Get it from any user that has this Twilio number configured (simplified: use first dealership)
    if is_unknown_caller and not dealership_id:
        from app.models.dealership import Dealership
        result = await db.execute(select(Dealership).limit(1))
        dealership = result.scalar_one_or_none()
        if dealership:
            dealership_id = dealership.id
    
    # For unknown callers, create minimal lead
    if is_unknown_caller and dealership_id:
        lead, customer = await service.create_minimal_lead_for_unknown_caller(
            phone=from_number,
            dealership_id=dealership_id
        )
        requires_lead_details = True
        logger.info(f"Created minimal lead {lead.id} for unknown caller {from_number}")
    
    # Find users to ring (ring group)
    users_to_ring, _ = await service.find_users_for_incoming_call(lead, dealership_id)
    
    # Create call log
    call_log = await service.create_call_log(
        twilio_call_sid=call_sid,
        direction=CallDirection.INBOUND,
        from_number=from_number,
        to_number=to_number,
        user_id=users_to_ring[0].id if len(users_to_ring) == 1 else None,  # Only set if single user
        lead_id=lead.id if lead else None,
        customer_id=lead.customer_id if lead else None,
        dealership_id=dealership_id or (users_to_ring[0].dealership_id if users_to_ring else None),
        status=CallStatus.RINGING
    )
    
    # Set requires_lead_details flag for unknown callers
    if requires_lead_details:
        call_log.requires_lead_details = True
    
    await db.commit()
    
    # Send real-time notification to all users being ringed
    for user in users_to_ring:
        await ws_manager.send_to_user(
            str(user.id),
            {
                "type": "call:incoming",
                "payload": {
                    "call_log_id": str(call_log.id),
                    "call_sid": call_sid,
                    "from_number": from_number,
                    "lead_id": str(lead.id) if lead else None,
                    "lead_name": lead.full_name if lead else None,
                    "is_ring_group": len(users_to_ring) > 1,
                }
            }
        )
    
    # Generate TwiML
    if users_to_ring:
        if len(users_to_ring) == 1:
            # Single user - use direct routing
            twiml = service.generate_twiml_for_incoming(users_to_ring[0].email)
        else:
            # Multiple users - use ring group (simultaneous ring)
            user_identities = [u.email for u in users_to_ring]
            twiml = service.generate_twiml_ring_group(user_identities, timeout=30)
            logger.info(f"Ring group for call {call_sid}: {len(users_to_ring)} users")
    else:
        # No users available - go to voicemail
        twiml = service.generate_twiml_voicemail()
    
    return Response(content=twiml, media_type="application/xml")


@router.post("/webhook/outgoing")
async def handle_outgoing_call(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for outgoing calls initiated from WebRTC client.
    Returns TwiML to connect the call.
    """
    try:
        form_data = await request.form()
    except Exception as e:
        logger.exception(f"Outgoing webhook failed to parse form: {e}")
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say></Response>',
            media_type="application/xml",
        )

    call_sid = form_data.get("CallSid", "")
    to_number = (form_data.get("To") or "").strip()
    from_identity = form_data.get("From", "")

    logger.info(f"Outgoing call webhook: {call_sid} to {to_number!r} from {from_identity!r}")

    if not to_number:
        logger.warning("Outgoing webhook missing To number")
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>No number to dial.</Say></Response>',
            media_type="application/xml",
        )

    try:
        service = get_voice_service(db)
        # Create call_log only here with real CallSid (no pending rows)
        await service.ensure_call_log_for_outgoing(
            call_sid=call_sid,
            from_identity=from_identity,
            to_number=to_number,
        )
        await db.commit()
        twiml = service.generate_twiml_for_outbound(to_number)
        return Response(content=twiml, media_type="application/xml")
    except Exception as e:
        logger.exception(f"Outgoing webhook error for call {call_sid}: {e}")
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, the call could not be completed.</Say></Response>',
            media_type="application/xml",
        )


@router.post("/webhook/status")
async def handle_call_status(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for call status updates.
    For Dial (incoming and outbound): Twilio POSTs to the Dial action URL when the dialed leg ends.
    Request includes CallSid (parent call), DialCallStatus, DialCallDuration. We prefer those for Dial.
    
    Also handles:
    - Tracking who answered (via Called parameter for ring groups)
    - Auto-assigning lead to person who answered
    - Sending WebSocket event for unknown caller lead details
    
    Always return 200 + TwiML so Twilio ends the call cleanly.
    """
    empty_twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    try:
        form_data = await request.form()
    except Exception as e:
        logger.exception("Status webhook failed to parse form: %s", e)
        return Response(content=empty_twiml, media_type="application/xml")

    # CallSid is the parent call (the leg we have in call_log). Dial action sends DialCallStatus/DialCallDuration.
    call_sid = form_data.get("CallSid", "")
    call_status = form_data.get("DialCallStatus") or form_data.get("CallStatus", "")
    call_duration = form_data.get("DialCallDuration") or form_data.get("CallDuration", "")
    # Called contains the client identity that answered (e.g., "client:user@email.com")
    called_identity = form_data.get("Called", "")

    logger.info(
        "Call status webhook: CallSid=%s DialCallStatus=%s CallStatus=%s duration=%s Called=%s",
        call_sid,
        form_data.get("DialCallStatus"),
        form_data.get("CallStatus"),
        call_duration,
        called_identity,
    )

    status_map = {
        "queued": CallStatus.INITIATED,
        "ringing": CallStatus.RINGING,
        "in-progress": CallStatus.IN_PROGRESS,
        "completed": CallStatus.COMPLETED,
        "answered": CallStatus.COMPLETED,
        "busy": CallStatus.BUSY,
        "no-answer": CallStatus.NO_ANSWER,
        "failed": CallStatus.FAILED,
        "canceled": CallStatus.CANCELED,
    }

    status = status_map.get((call_status or "").lower(), CallStatus.FAILED)
    try:
        duration = int(call_duration) if call_duration else None
    except (TypeError, ValueError):
        duration = None

    try:
        service = get_voice_service(db)
        call_log = await service.update_call_status(
            call_sid=call_sid,
            status=status,
            duration=duration
        )

        if call_log:
            # Track who answered the call (for ring groups)
            answered_by_user = None
            if called_identity and status == CallStatus.IN_PROGRESS:
                answered_by_user = await service.get_user_by_identity(called_identity)
                if answered_by_user:
                    call_log.answered_by = answered_by_user.id
                    # Also set user_id if not already set (ring group scenario)
                    if not call_log.user_id:
                        call_log.user_id = answered_by_user.id
                    logger.info(f"Call {call_sid} answered by user {answered_by_user.id}")
                    
                    # Auto-assign lead if unassigned
                    if call_log.direction == CallDirection.INBOUND:
                        assigned = await service.auto_assign_lead_on_answer(call_log, answered_by_user)
                        if assigned:
                            logger.info(f"Lead auto-assigned to {answered_by_user.id} via call {call_sid}")
            
            # Log activity for completed calls
            if status in [CallStatus.COMPLETED, CallStatus.BUSY, CallStatus.NO_ANSWER, CallStatus.FAILED]:
                await service.log_call_activity(call_log)
                
                # Send WebSocket event for unknown caller needing lead details
                if call_log.requires_lead_details and call_log.answered_by and status == CallStatus.COMPLETED:
                    await ws_manager.send_to_user(
                        str(call_log.answered_by),
                        {
                            "type": "call:needs_lead_details",
                            "payload": {
                                "call_log_id": str(call_log.id),
                                "lead_id": str(call_log.lead_id) if call_log.lead_id else None,
                                "phone_number": call_log.from_number,
                            }
                        }
                    )
            
            # Send status update to user
            target_user_id = call_log.answered_by or call_log.user_id
            if target_user_id:
                await ws_manager.send_to_user(
                    str(target_user_id),
                    {
                        "type": "call:status",
                        "payload": {
                            "call_log_id": str(call_log.id),
                            "call_sid": call_sid,
                            "status": status.value,
                            "duration_seconds": call_log.duration_seconds
                        }
                    }
                )
        else:
            logger.warning("Status webhook: no call_log for CallSid=%s", call_sid)

        await db.commit()
    except Exception as e:
        logger.exception("Status webhook error for CallSid=%s: %s", call_sid, e)
        try:
            await db.rollback()
        except Exception:
            pass

    return Response(content=empty_twiml, media_type="application/xml")


@router.post("/webhook/recording")
async def handle_recording_complete(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for recording completion.
    Returns immediately to Twilio, then downloads recording and uploads to Azure in background.
    """
    form_data = await request.form()
    
    call_sid = form_data.get("CallSid", "")
    recording_sid = form_data.get("RecordingSid", "")
    recording_url = form_data.get("RecordingUrl", "")
    recording_duration = form_data.get("RecordingDuration", "0")
    
    logger.info(f"Recording webhook: {call_sid} -> {recording_sid}")
    
    try:
        duration = int(recording_duration)
    except (TypeError, ValueError):
        duration = 0
    
    # Mark recording as pending upload in the call_log
    result = await db.execute(
        select(CallLog).where(CallLog.twilio_call_sid == call_sid)
    )
    call_log = result.scalar_one_or_none()
    
    if call_log:
        call_log.recording_upload_status = "pending"
        await db.commit()
    
    # Queue background task for downloading from Twilio and uploading to Azure
    # This runs outside the request context with its own DB session
    from app.services.voice_service import upload_recording_to_azure_background
    background_tasks.add_task(
        upload_recording_to_azure_background,
        call_sid=call_sid,
        recording_url=recording_url,
        recording_sid=recording_sid,
        recording_duration=duration,
    )
    
    # Return immediately to Twilio
    return {"status": "ok"}
