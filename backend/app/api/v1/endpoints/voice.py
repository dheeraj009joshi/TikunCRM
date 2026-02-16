"""
Voice API Endpoints - Twilio WebRTC Softphone
"""
import logging
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status, Query
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
    """Response for call initiation"""
    call_log_id: UUID
    call_sid: str
    status: str


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


class VoiceConfigResponse(BaseModel):
    """Voice configuration status"""
    voice_enabled: bool
    phone_number: Optional[str]
    recording_enabled: bool
    azure_storage_configured: bool


# ============ Endpoints ============

@router.get("/config", response_model=VoiceConfigResponse)
async def get_voice_config(
    current_user: User = Depends(deps.get_current_active_user)
):
    """Get voice configuration status"""
    return VoiceConfigResponse(
        voice_enabled=settings.is_twilio_voice_configured,
        phone_number=settings.twilio_phone_number if settings.is_twilio_voice_configured else None,
        recording_enabled=True,  # Always record for compliance
        azure_storage_configured=settings.is_azure_storage_configured
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
    
    try:
        # Create call log entry
        call_log = await service.create_call_log(
            twilio_call_sid=f"pending_{current_user.id}_{datetime.utcnow().timestamp()}",
            direction=CallDirection.OUTBOUND,
            from_number=settings.twilio_phone_number,
            to_number=formatted_number,
            user_id=current_user.id,
            lead_id=lead.id if lead else None,
            customer_id=lead.customer_id if lead else None,
            dealership_id=dealership_id,
            status=CallStatus.INITIATED
        )
        
        await db.commit()
        
        return InitiateCallResponse(
            call_log_id=call_log.id,
            call_sid=call_log.twilio_call_sid,
            status=call_log.status.value
        )
        
    except Exception as e:
        logger.error(f"Failed to initiate call: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate call"
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
    Routes call to the appropriate user's WebRTC client.
    """
    form_data = await request.form()
    
    call_sid = form_data.get("CallSid", "")
    from_number = form_data.get("From", "")
    to_number = form_data.get("To", "")
    
    logger.info(f"Incoming call webhook: {call_sid} from {from_number} to {to_number}")
    
    service = get_voice_service(db)
    
    # Try to find the lead by phone number
    lead = await service.find_lead_by_phone(from_number)
    
    # Find user to route the call to
    user = await service.find_user_for_incoming_call(lead)
    
    # Create call log
    call_log = await service.create_call_log(
        twilio_call_sid=call_sid,
        direction=CallDirection.INBOUND,
        from_number=from_number,
        to_number=to_number,
        user_id=user.id if user else None,
        lead_id=lead.id if lead else None,
        customer_id=lead.customer_id if lead else None,
        dealership_id=(lead.dealership_id if lead else None) or (user.dealership_id if user else None),
        status=CallStatus.RINGING
    )
    
    await db.commit()
    
    # Send real-time notification to user
    if user:
        await ws_manager.send_to_user(
            str(user.id),
            {
                "type": "call:incoming",
                "payload": {
                    "call_log_id": str(call_log.id),
                    "call_sid": call_sid,
                    "from_number": from_number,
                    "lead_id": str(lead.id) if lead else None,
                    "lead_name": lead.full_name if lead else None
                }
            }
        )
        
        # Generate TwiML to route to user's WebRTC client
        twiml = service.generate_twiml_for_incoming(user.email)
    else:
        # No user available - go to voicemail
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
        await service.update_pending_call_log_with_sid(
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
    Called either by call status callback or by Dial action when the dialed call ends.
    Dial action sends DialCallStatus and DialCallDuration; status callback sends CallStatus and CallDuration.
    """
    form_data = await request.form()

    call_sid = form_data.get("CallSid", "")
    call_status = form_data.get("CallStatus") or form_data.get("DialCallStatus", "")
    call_duration = form_data.get("CallDuration") or form_data.get("DialCallDuration")

    logger.info(f"Call status webhook: {call_sid} -> {call_status} (duration={call_duration})")

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
    duration = int(call_duration) if call_duration else None

    service = get_voice_service(db)
    call_log = await service.update_call_status(
        call_sid=call_sid,
        status=status,
        duration=duration
    )
    
    if call_log:
        # Log activity if call is completed
        if status in [CallStatus.COMPLETED, CallStatus.BUSY, CallStatus.NO_ANSWER, CallStatus.FAILED]:
            await service.log_call_activity(call_log)
        
        # Send real-time update
        if call_log.user_id:
            await ws_manager.send_to_user(
                str(call_log.user_id),
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
    
    await db.commit()

    # Dial action expects TwiML; return empty response so Twilio ends the call cleanly
    return Response(
        content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        media_type="application/xml",
    )


@router.post("/webhook/recording")
async def handle_recording_complete(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for recording completion.
    Downloads recording and uploads to Azure Blob Storage.
    """
    form_data = await request.form()
    
    call_sid = form_data.get("CallSid", "")
    recording_sid = form_data.get("RecordingSid", "")
    recording_url = form_data.get("RecordingUrl", "")
    recording_duration = form_data.get("RecordingDuration", "0")
    
    logger.info(f"Recording webhook: {call_sid} -> {recording_sid}")
    
    service = get_voice_service(db)
    call_log = await service.handle_recording_complete(
        call_sid=call_sid,
        recording_sid=recording_sid,
        recording_url=recording_url,
        recording_duration=int(recording_duration)
    )
    
    if call_log and call_log.user_id:
        # Notify user that recording is ready
        await ws_manager.send_to_user(
            str(call_log.user_id),
            {
                "type": "call:recording_ready",
                "payload": {
                    "call_log_id": str(call_log.id),
                    "call_sid": call_sid,
                    "recording_url": call_log.recording_url
                }
            }
        )
    
    await db.commit()
    
    return {"status": "ok"}
