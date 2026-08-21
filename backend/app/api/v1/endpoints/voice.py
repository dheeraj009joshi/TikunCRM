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
from app.services.dealership_twilio_config_service import (
    get_effective_twilio_config,
    find_dealership_id_by_voice_to,
)
from sqlalchemy.orm.attributes import flag_modified
from app.core.timezone import utc_now
from app.core.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

# Always-valid TwiML so Twilio never plays "An application error has occurred"
_FALLBACK_VOICEMAIL_TWIML = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    "<Response>"
    "<Say>Sorry, no one is available to take your call. Please leave a message after the beep.</Say>"
    "<Record maxLength=\"120\" playBeep=\"true\" timeout=\"5\"/>"
    "<Hangup/>"
    "</Response>"
)

async def _notify_incoming_ring_background(
    user_ids: List[str],
    from_number: str,
    lead_name: Optional[str],
    lead_id: Optional[str],
    call_sid: str,
    call_log_id: str,
) -> None:
    """FCM + WS after TwiML is already returned — must not block Twilio (15s)."""
    from app.db.database import async_session_maker
    from app.services.push_service import push_service

    try:
        for uid in user_ids:
            await ws_manager.send_to_user(
                uid,
                {
                    "type": "call:incoming",
                    "payload": {
                        "call_log_id": call_log_id,
                        "call_sid": call_sid,
                        "from_number": from_number,
                        "lead_id": lead_id,
                        "lead_name": lead_name,
                        "is_ring_group": len(user_ids) > 1,
                    },
                },
            )
    except Exception as e:
        logger.warning("Incoming-call WebSocket notify failed: %s", e)

    try:
        async with async_session_maker() as db:
            await push_service.notify_incoming_call(
                db,
                [UUID(uid) for uid in user_ids],
                from_number=from_number,
                lead_name=lead_name,
                lead_id=UUID(lead_id) if lead_id else None,
                call_sid=call_sid,
                call_log_id=UUID(call_log_id),
            )
    except Exception as e:
        logger.warning("Incoming-call FCM push failed: %s", e)


async def _notify_missed_inbound_background(call_log_id: str) -> None:
    """Missed-call email/push after Dial-action TwiML is already returned."""
    from app.db.database import async_session_maker

    try:
        async with async_session_maker() as db:
            service = get_voice_service(db)
            result = await db.execute(select(CallLog).where(CallLog.id == UUID(call_log_id)))
            call_log = result.scalar_one_or_none()
            if not call_log:
                return
            await service.notify_missed_inbound_call(call_log)
            await db.commit()
    except Exception as e:
        logger.warning("Background missed-call notify failed for %s: %s", call_log_id, e)


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


class MissedCallItem(BaseModel):
    """Missed inbound call that still needs attention"""
    id: UUID
    lead_id: Optional[UUID] = None
    dealership_id: Optional[UUID] = None
    from_number: str
    to_number: str
    status: str
    started_at: datetime
    created_at: datetime
    lead_name: Optional[str] = None
    is_seen: bool = False
    called_back: bool = False


class MissedCallsResponse(BaseModel):
    items: List[MissedCallItem]
    total: int
    pending_count: int


MISSED_STATUSES = {
    CallStatus.NO_ANSWER,
    CallStatus.BUSY,
    CallStatus.FAILED,
    CallStatus.CANCELED,
}


def _digits_phone(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in value if ch.isdigit())


def _phones_match(a: Optional[str], b: Optional[str]) -> bool:
    da, db = _digits_phone(a), _digits_phone(b)
    if not da or not db:
        return False
    return da == db or da[-10:] == db[-10:]


def _call_log_to_response(call: CallLog) -> CallLogResponse:
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
        user_name=call.user.full_name if call.user else None,
    )


def _apply_call_access_filter(query, current_user: User):
    """Restrict call queries by role (salespeople see assigned-lead + own calls)."""
    if current_user.role == UserRole.SALESPERSON:
        assigned = select(Lead.id).where(Lead.assigned_to == current_user.id)
        return query.where(
            (CallLog.user_id == current_user.id) | (CallLog.lead_id.in_(assigned))
        )
    if current_user.role in (
        UserRole.DEALERSHIP_ADMIN,
        UserRole.DEALERSHIP_OWNER,
        UserRole.BDC,
    ):
        if current_user.dealership_id:
            return query.where(CallLog.dealership_id == current_user.dealership_id)
    return query


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
    dealership_id: Optional[UUID] = Query(None),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get voice configuration status. When voice_enabled is false, missing_credentials lists env vars to set."""
    service = get_voice_service(db)
    resolved = await service.resolve_voice_dealership_id(
        current_user, preferred_dealership_id=dealership_id
    )
    effective = await get_effective_twilio_config(db, resolved)
    enabled = effective.is_voice_ready()
    missing = None if enabled else _voice_missing_credentials()
    return VoiceConfigResponse(
        voice_enabled=enabled,
        phone_number=effective.voice_caller_id_number if enabled else None,
        recording_enabled=True,
        azure_storage_configured=settings.is_azure_storage_configured,
        missing_credentials=missing,
    )


@router.get("/config/status")
async def get_voice_config_status(
    dealership_id: Optional[UUID] = Query(None),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Debug: effective voice readiness (merged dealership row + env). No secret values.
    """
    service = get_voice_service(db)
    resolved = await service.resolve_voice_dealership_id(
        current_user, preferred_dealership_id=dealership_id
    )
    effective = await get_effective_twilio_config(db, resolved)
    return {
        "voice_enabled": effective.is_voice_ready(),
        "checks": {
            "account_sid": bool(effective.account_sid),
            "auth_token": bool(effective.auth_token),
            "voice_caller_id_number": bool(effective.voice_caller_id_number),
            "twilio_twiml_app_sid": bool(effective.twilio_twiml_app_sid),
            "twilio_api_key_sid": bool(effective.twilio_api_key_sid),
            "twilio_api_key_secret": bool(effective.twilio_api_key_secret),
        },
    }


@router.post("/token", response_model=VoiceTokenResponse)
async def get_voice_token(
    dealership_id: Optional[UUID] = Query(
        None,
        description="Preferred dealership for BDC multi-store voice config",
    ),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a Twilio access token for the WebRTC softphone.
    Token is valid for 1 hour and allows making/receiving calls.
    BDC agents (dealership_id=NULL) resolve Twilio config via accessible dealerships.
    """
    service = get_voice_service(db)
    resolved_dealership_id = await service.resolve_voice_dealership_id(
        current_user, preferred_dealership_id=dealership_id
    )
    effective = await get_effective_twilio_config(db, resolved_dealership_id)
    if not effective.is_voice_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice calling is not configured"
        )

    # Use the user UUID as the Twilio client identity. With multi-dealership
    # accounts the same email may belong to multiple users, so email is no
    # longer a unique identifier — user.id is.
    identity = str(current_user.id)

    try:
        token = service.generate_access_token(
            user_id=current_user.id,
            identity=identity,
            effective=effective,
            ttl=3600,
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
    service = get_voice_service(db)

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
    if request.lead_id:
        result = await db.execute(
            select(Lead).where(Lead.id == request.lead_id)
        )
        lead = result.scalar_one_or_none()
    else:
        # Try to find lead by phone number
        lead = await service.find_lead_by_phone(formatted_number)

    resolved_dealership_id = await service.resolve_voice_dealership_id(
        current_user, lead=lead
    )
    effective = await get_effective_twilio_config(db, resolved_dealership_id)
    if not effective.is_voice_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice calling is not configured"
        )
    
    # Do not create call_log here; it is created in the outgoing webhook when Twilio sends the real CallSid.
    return InitiateCallResponse(
        call_log_id=None,
        call_sid="connecting",
        status="initiated"
    )


@router.get("/calls/missed", response_model=MissedCallsResponse)
async def list_missed_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Missed inbound calls that still need attention:
    not yet seen in the calls tray, or not yet called back.
    Badge `pending_count` = unseen OR not called back.
    """
    query = (
        select(CallLog)
        .where(
            CallLog.direction == CallDirection.INBOUND,
            CallLog.status.in_(list(MISSED_STATUSES)),
        )
        .options(selectinload(CallLog.lead))
        .order_by(CallLog.started_at.desc())
        .limit(200)
    )
    query = _apply_call_access_filter(query, current_user)
    result = await db.execute(query)
    missed_calls = list(result.scalars().all())
    if not missed_calls:
        return MissedCallsResponse(items=[], total=0, pending_count=0)

    # Load recent outbound calls in the same scope to detect callbacks
    oldest = min(c.started_at for c in missed_calls)
    outbound_q = (
        select(CallLog)
        .where(
            CallLog.direction == CallDirection.OUTBOUND,
            CallLog.started_at >= oldest,
        )
        .order_by(CallLog.started_at.asc())
        .limit(500)
    )
    outbound_q = _apply_call_access_filter(outbound_q, current_user)
    outbound_res = await db.execute(outbound_q)
    outbound_calls = list(outbound_res.scalars().all())

    items: List[MissedCallItem] = []
    for call in missed_calls:
        meta = call.meta_data or {}
        is_seen = bool(meta.get("missed_seen_at"))
        # User dismissed via "Mark all read" — treat as no longer needing callback
        called_back = bool(meta.get("missed_callback_cleared_at"))
        if not called_back:
            for out in outbound_calls:
                if out.started_at <= call.started_at:
                    continue
                if call.lead_id and out.lead_id and out.lead_id == call.lead_id:
                    called_back = True
                    break
                if _phones_match(out.to_number, call.from_number):
                    called_back = True
                    break
        # Hide fully handled (seen + called back / cleared)
        if is_seen and called_back:
            continue
        items.append(
            MissedCallItem(
                id=call.id,
                lead_id=call.lead_id,
                dealership_id=call.dealership_id,
                from_number=call.from_number,
                to_number=call.to_number,
                status=call.status.value,
                started_at=call.started_at,
                created_at=call.created_at,
                lead_name=call.lead.full_name if call.lead else None,
                is_seen=is_seen,
                called_back=called_back,
            )
        )

    pending_count = sum(1 for i in items if (not i.is_seen) or (not i.called_back))
    total = len(items)
    offset = (page - 1) * page_size
    page_items = items[offset : offset + page_size]
    return MissedCallsResponse(
        items=page_items,
        total=total,
        pending_count=pending_count,
    )


@router.post("/calls/missed/mark-all-seen")
async def mark_all_missed_calls_seen(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Clear all accessible missed calls from the tray:
    mark as seen and treat as no longer needing callback.
    """
    query = select(CallLog).where(
        CallLog.direction == CallDirection.INBOUND,
        CallLog.status.in_(list(MISSED_STATUSES)),
    )
    query = _apply_call_access_filter(query, current_user)
    result = await db.execute(query)
    calls = list(result.scalars().all())

    now = utc_now().isoformat()
    marked = 0
    for call in calls:
        meta = dict(call.meta_data or {})
        already_cleared = bool(meta.get("missed_seen_at")) and bool(
            meta.get("missed_callback_cleared_at")
        )
        if already_cleared:
            continue
        meta["missed_seen_at"] = meta.get("missed_seen_at") or now
        meta["missed_seen_by"] = str(current_user.id)
        meta["missed_callback_cleared_at"] = now
        meta["missed_callback_cleared_by"] = str(current_user.id)
        call.meta_data = meta
        flag_modified(call, "meta_data")
        marked += 1

    if marked:
        await db.commit()
    return {"ok": True, "marked": marked}


@router.post("/calls/{call_id}/mark-missed-seen")
async def mark_missed_call_seen(
    call_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a missed inbound call as seen in the calls tray."""
    query = select(CallLog).where(CallLog.id == call_id)
    query = _apply_call_access_filter(query, current_user)
    result = await db.execute(query)
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Call not found")

    meta = dict(call.meta_data or {})
    meta["missed_seen_at"] = utc_now().isoformat()
    meta["missed_seen_by"] = str(current_user.id)
    call.meta_data = meta
    flag_modified(call, "meta_data")
    await db.commit()
    return {"ok": True, "id": str(call.id)}


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
    
    # Check access: salesperson can access if they are call owner or the one who answered
    if current_user.role == UserRole.SALESPERSON:
        if call.user_id != current_user.id and call.answered_by != current_user.id:
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
    if current_user.role == UserRole.SALESPERSON:
        if call.user_id != current_user.id and call.answered_by != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if not call.recording_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No recording available")

    import httpx
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Twilio URLs require auth
            if "api.twilio.com" in call.recording_url:
                eff = await get_effective_twilio_config(db, call.dealership_id)
                r = await client.get(
                    call.recording_url,
                    auth=(eff.account_sid, eff.auth_token),
                    follow_redirects=True,
                )
            else:
                # Azure/public URLs - no auth needed
                r = await client.get(
                    call.recording_url,
                    follow_redirects=True,
                )
            r.raise_for_status()
            media_type = r.headers.get("content-type", "audio/wav")
            return Response(content=r.content, media_type=media_type)
    except Exception as e:
        logger.warning(f"Failed to fetch recording for {call_id}: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to load recording")


# ============ Twilio Webhooks ============

@router.post("/webhook/incoming", response_class=PlainTextResponse)
async def handle_incoming_call(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Twilio webhook for incoming calls.
    Routes call to dealership ring group (sales + admins + BDC).

    Ring rules:
    - Always ring all active salespersons, dealership admins/owners, and BDC
      for the dealership (assignment does not narrow the ring group).
    - First person to answer gets the call (and may be auto-assigned).
    - Unknown callers: create a minimal lead, then ring the same group.
    """
    form_data = await request.form()
    
    call_sid = form_data.get("CallSid", "")
    from_number = form_data.get("From", "")
    to_number = form_data.get("To", "")
    
    logger.info(f"Incoming call webhook: {call_sid} from {from_number} to {to_number}")

    try:
        service = get_voice_service(db)

        # Try to find the lead by phone number
        lead = await service.find_lead_by_phone(from_number)
        is_unknown_caller = lead is None
        requires_lead_details = False

        dealership_id = lead.dealership_id if lead else None
        dealership_from_to = await find_dealership_id_by_voice_to(db, to_number)
        if dealership_from_to:
            dealership_id = dealership_id or dealership_from_to

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

        # Create call log (Twilio retries reuse the same CallSid)
        call_log = await service.get_call_by_sid(call_sid) if call_sid else None
        if not call_log:
            call_log = await service.create_call_log(
                twilio_call_sid=call_sid,
                direction=CallDirection.INBOUND,
                from_number=from_number,
                to_number=to_number,
                user_id=users_to_ring[0].id if len(users_to_ring) == 1 else None,
                lead_id=lead.id if lead else None,
                customer_id=lead.customer_id if lead else None,
                dealership_id=dealership_id or (users_to_ring[0].dealership_id if users_to_ring else None),
                status=CallStatus.RINGING
            )

        if requires_lead_details:
            call_log.requires_lead_details = True

        await db.commit()

        lead_name = None
        if lead:
            try:
                lead_name = await service._call_lead_display_name(lead.id)
            except Exception:
                lead_name = None

        # Notify AFTER TwiML is returned — FCM/email here used to exceed Twilio's 15s limit
        if users_to_ring:
            background_tasks.add_task(
                _notify_incoming_ring_background,
                [str(u.id) for u in users_to_ring],
                from_number,
                lead_name,
                str(lead.id) if lead else None,
                call_sid,
                str(call_log.id),
            )

        if users_to_ring:
            user_identities = [service.client_identity_for_user(u) for u in users_to_ring]
            if len(user_identities) == 1:
                twiml = service.generate_twiml_for_incoming(
                    user_identities[0], timeout=45, wake_pause_seconds=1
                )
            else:
                twiml = service.generate_twiml_ring_group(
                    user_identities, timeout=45, wake_pause_seconds=1
                )
                logger.info(
                    "Ring group for call %s: %d users (identities=%s)",
                    call_sid,
                    len(users_to_ring),
                    [u.email for u in users_to_ring],
                )
        else:
            twiml = service.generate_twiml_voicemail()

        return Response(content=twiml, media_type="application/xml")
    except Exception as e:
        logger.exception("Incoming call webhook failed for CallSid=%s: %s", call_sid, e)
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            twiml = get_voice_service(db).generate_twiml_voicemail()
        except Exception:
            twiml = _FALLBACK_VOICEMAIL_TWIML
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
    lead_id_raw = (form_data.get("lead_id") or "").strip()
    lead_id = None
    if lead_id_raw:
        try:
            lead_id = UUID(lead_id_raw)
        except ValueError:
            logger.warning("Outgoing webhook invalid lead_id=%r", lead_id_raw)

    logger.info(f"Outgoing call webhook: {call_sid} to {to_number!r} from {from_identity!r}")

    if not to_number:
        logger.warning("Outgoing webhook missing To number")
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>No number to dial.</Say></Response>',
            media_type="application/xml",
        )

    try:
        service = get_voice_service(db)
        call_log, effective = await service.ensure_call_log_for_outgoing(
            call_sid=call_sid,
            from_identity=from_identity,
            to_number=to_number,
            lead_id=lead_id,
        )
        if not call_log:
            logger.warning("Outgoing webhook: could not create call log (unknown user)")
            return Response(
                content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we could not place your call.</Say></Response>',
                media_type="application/xml",
            )
        await db.commit()
        if not effective or not effective.is_voice_ready():
            return Response(
                content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>Voice is not configured for your account.</Say></Response>',
                media_type="application/xml",
            )
        twiml = service.generate_twiml_for_outbound(to_number, effective)
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
    background_tasks: BackgroundTasks,
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

    # CallSid is usually the parent call (the leg we have in call_log).
    # Dial action sends DialCallStatus/DialCallDuration; ParentCallSid may appear on child legs.
    call_sid = form_data.get("CallSid", "")
    parent_call_sid = form_data.get("ParentCallSid", "")
    call_status = form_data.get("DialCallStatus") or form_data.get("CallStatus", "")
    call_duration = form_data.get("DialCallDuration") or form_data.get("CallDuration", "")
    # Called contains the client identity that answered (e.g., "client:user@email.com")
    called_identity = form_data.get("Called", "")

    logger.info(
        "Call status webhook: CallSid=%s ParentCallSid=%s DialCallStatus=%s CallStatus=%s duration=%s Called=%s",
        call_sid,
        parent_call_sid,
        form_data.get("DialCallStatus"),
        form_data.get("CallStatus"),
        call_duration,
        called_identity,
    )

    status_map = {
        "queued": CallStatus.INITIATED,
        "initiated": CallStatus.INITIATED,
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

    call_log = None
    is_inbound_call = False
    try:
        service = get_voice_service(db)
        call_log = await service.update_call_status(
            call_sid=call_sid,
            status=status,
            duration=duration,
            parent_call_sid=parent_call_sid or None,
        )

        if call_log:
            is_inbound_call = call_log.direction == CallDirection.INBOUND
            # Attribute answerer for ring groups / BDC.
            # Dial action usually sends DialCallStatus=completed (not in-progress).
            # Client identity may appear in Called, To, or DialCallSid-related fields.
            answered_by_user = None
            identity_candidates = [
                called_identity,
                form_data.get("To", ""),
                form_data.get("Caller", ""),
                form_data.get("ForwardedFrom", ""),
            ]
            if status in {CallStatus.IN_PROGRESS, CallStatus.COMPLETED} and not call_log.answered_by:
                for candidate in identity_candidates:
                    if not candidate:
                        continue
                    # Only treat client: identities (or raw UUID/email) as answerers
                    normalized = service._normalize_identity(str(candidate))
                    if not normalized:
                        continue
                    # Skip PSTN numbers (answered legs to phones shouldn't use this path)
                    digits = "".join(c for c in normalized if c.isdigit())
                    if len(digits) >= 10 and normalized.replace("+", "").replace("-", "").replace(" ", "").isdigit():
                        continue
                    answered_by_user = await service.get_user_by_identity(normalized)
                    if answered_by_user:
                        break
                if answered_by_user:
                    await service.attribute_answered_user(
                        call_log, answered_by_user, auto_assign=True
                    )
            
            # Log activity for completed / missed / canceled calls
            if status in [
                CallStatus.COMPLETED,
                CallStatus.BUSY,
                CallStatus.NO_ANSWER,
                CallStatus.FAILED,
                CallStatus.CANCELED,
            ]:
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
                
                # Broadcast call:completed to dealership for real-time timeline updates
                if call_log.dealership_id and call_log.lead_id:
                    try:
                        await ws_manager.broadcast_to_dealership(
                            str(call_log.dealership_id),
                            {
                                "type": "call:completed",
                                "payload": {
                                    "call_log_id": str(call_log.id),
                                    "lead_id": str(call_log.lead_id),
                                    "call": {
                                        "id": str(call_log.id),
                                        "direction": call_log.direction.value if call_log.direction else "outbound",
                                        "from_number": call_log.from_number,
                                        "to_number": call_log.to_number,
                                        "status": call_log.status.value if call_log.status else status.value,
                                        "duration_seconds": call_log.duration_seconds,
                                        "outcome": call_log.outcome,
                                        "notes": call_log.notes,
                                        "recording_url": call_log.recording_url,
                                        "started_at": call_log.started_at.isoformat() if call_log.started_at else None,
                                        "ended_at": call_log.ended_at.isoformat() if call_log.ended_at else None,
                                    }
                                }
                            }
                        )
                    except Exception as e:
                        logger.warning("call:completed broadcast failed: %s", e)

            # Missed inbound — stamp outcome now; email/push AFTER TwiML (Twilio 15s limit)
            dial_status_for_notify = (form_data.get("DialCallStatus") or "").lower()
            if (
                is_inbound_call
                and dial_status_for_notify in {"no-answer", "busy", "failed", "canceled"}
            ):
                if not call_log.answered_by and (call_log.outcome or "") not in {"voicemail"}:
                    call_log.outcome = "missed"
                background_tasks.add_task(_notify_missed_inbound_background, str(call_log.id))
                if call_log.dealership_id:
                    try:
                        await ws_manager.broadcast_to_dealership(
                            str(call_log.dealership_id),
                            {
                                "type": "call:ring_ended",
                                "payload": {
                                    "call_log_id": str(call_log.id),
                                    "call_sid": call_log.twilio_call_sid,
                                    "status": dial_status_for_notify,
                                    "lead_id": str(call_log.lead_id) if call_log.lead_id else None,
                                },
                            },
                        )
                    except Exception as e:
                        logger.warning("call:ring_ended broadcast failed: %s", e)

            # Someone answered the inbound Dial — clear modals for agents who didn't pick up
            if (
                is_inbound_call
                and status == CallStatus.COMPLETED
                and call_log.answered_by
                and call_log.dealership_id
            ):
                try:
                    await ws_manager.broadcast_to_dealership(
                        str(call_log.dealership_id),
                        {
                            "type": "call:answered",
                            "payload": {
                                "call_log_id": str(call_log.id),
                                "call_sid": call_log.twilio_call_sid,
                                "answered_by": str(call_log.answered_by),
                                "lead_id": str(call_log.lead_id) if call_log.lead_id else None,
                            },
                        },
                    )
                except Exception as e:
                    logger.warning("call:answered (status) broadcast failed: %s", e)
            
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

    # Inbound Dial timed out / busy / failed → offer voicemail instead of hanging up
    dial_status = (form_data.get("DialCallStatus") or "").lower()
    offer_voicemail = dial_status in {"no-answer", "busy", "failed", "canceled"} and is_inbound_call
    if offer_voicemail:
        logger.info(
            "Inbound Dial %s for CallSid=%s — returning voicemail TwiML",
            dial_status,
            call_sid,
        )
        try:
            service = get_voice_service(db)
            twiml = service.generate_twiml_voicemail()
        except Exception:
            logger.exception("Failed to build voicemail TwiML for CallSid=%s", call_sid)
            twiml = empty_twiml
        return Response(content=twiml, media_type="application/xml")

    return Response(content=empty_twiml, media_type="application/xml")


@router.post("/webhook/client-status")
async def handle_client_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Per-<Client> status callback for ring groups.

    When a softphone (salesperson or BDC) answers, Twilio posts here with:
    - ParentCallSid = inbound parent CallSid (matches call_logs.twilio_call_sid)
    - To / Called = client:<user-uuid>
    - CallStatus = in-progress | completed | ...

    This is how we set call_log.user_id / answered_by for BDC agents who have
    no dealership_id on their user row.
    """
    try:
        form_data = await request.form()
    except Exception as e:
        logger.exception("Client status webhook failed to parse form: %s", e)
        return Response(status_code=204)

    call_sid = form_data.get("CallSid", "")
    parent_call_sid = form_data.get("ParentCallSid", "")
    call_status = (form_data.get("CallStatus") or "").lower()
    to_identity = form_data.get("To") or form_data.get("Called") or ""
    from_identity = form_data.get("From") or ""

    logger.info(
        "Client status webhook: CallSid=%s ParentCallSid=%s status=%s To=%s From=%s",
        call_sid,
        parent_call_sid,
        call_status,
        to_identity,
        from_identity,
    )

    # Only attribute on answer / bridged in-progress
    if call_status not in {"in-progress", "answered"}:
        return Response(status_code=204)

    service = get_voice_service(db)
    call_log = await service.get_call_log_by_sid(
        call_sid=call_sid, parent_call_sid=parent_call_sid or None
    )
    if not call_log:
        logger.warning(
            "Client status: no call_log for CallSid=%s ParentCallSid=%s",
            call_sid,
            parent_call_sid,
        )
        return Response(status_code=204)

    if call_log.answered_by:
        return Response(status_code=204)

    # Softphone legs use client:<uuid>; try To first, then From
    answered_by_user = None
    for candidate in (to_identity, from_identity):
        if not candidate:
            continue
        answered_by_user = await service.get_user_by_identity(str(candidate))
        if answered_by_user:
            break

    if not answered_by_user:
        logger.warning(
            "Client status: could not resolve user from To=%s From=%s",
            to_identity,
            from_identity,
        )
        return Response(status_code=204)

    await service.attribute_answered_user(call_log, answered_by_user, auto_assign=True)
    await db.commit()

    # Tell every softphone in the dealership to dismiss the incoming modal
    if call_log.dealership_id:
        try:
            await ws_manager.broadcast_to_dealership(
                str(call_log.dealership_id),
                {
                    "type": "call:answered",
                    "payload": {
                        "call_log_id": str(call_log.id),
                        "call_sid": call_log.twilio_call_sid,
                        "parent_call_sid": parent_call_sid or None,
                        "child_call_sid": call_sid or None,
                        "answered_by": str(answered_by_user.id),
                        "lead_id": str(call_log.lead_id) if call_log.lead_id else None,
                    },
                },
            )
        except Exception as e:
            logger.warning("call:answered broadcast failed: %s", e)

    return Response(status_code=204)


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
    
    # Store Twilio recording URL immediately so playback works before Azure upload completes
    service = get_voice_service(db)
    parent_call_sid = form_data.get("ParentCallSid", "")
    call_log = await service.get_call_log_by_sid(
        call_sid=call_sid, parent_call_sid=parent_call_sid or None
    )
    
    if call_log:
        call_log.recording_upload_status = "pending"
        call_log.recording_url = f"{recording_url}.wav" if recording_url else None
        call_log.recording_sid = recording_sid
        call_log.recording_duration_seconds = duration
        # If status webhook never finalized (stuck at initiated), complete + timeline from recording
        await service.finalize_call_from_recording(call_log, duration)
        await db.commit()
        
        # Broadcast recording availability for real-time timeline updates
        if call_log.dealership_id and call_log.lead_id:
            try:
                await ws_manager.broadcast_to_dealership(
                    str(call_log.dealership_id),
                    {
                        "type": "call:recording_ready",
                        "payload": {
                            "call_log_id": str(call_log.id),
                            "lead_id": str(call_log.lead_id),
                            "recording_url": call_log.recording_url,
                            "recording_duration_seconds": duration,
                        }
                    }
                )
            except Exception as e:
                logger.warning("call:recording_ready broadcast failed: %s", e)

            # Notify lead timeline clients that a call activity exists/updated
            try:
                await ws_manager.broadcast_to_dealership(
                    str(call_log.dealership_id),
                    {
                        "type": "call:completed",
                        "payload": {
                            "call_log_id": str(call_log.id),
                            "lead_id": str(call_log.lead_id),
                            "status": call_log.status.value,
                            "duration_seconds": call_log.duration_seconds,
                        },
                    },
                )
            except Exception as e:
                logger.warning("call:completed broadcast failed: %s", e)
    
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
