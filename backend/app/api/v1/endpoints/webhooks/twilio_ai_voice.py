"""
Twilio AI Voice Webhooks - TwiML generation and status callbacks
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Request, Response, HTTPException
from fastapi.responses import Response as FastAPIResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.models.lead import Lead
from app.models.ai_outbound_call import AiOutboundCall
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.core.config import settings
from app.core.timezone import utc_now
from app.services.ai_outbound_service import verify_lead_token

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/twiml")
async def ai_voice_twiml(request: Request) -> FastAPIResponse:
    """
    TwiML endpoint for AI voice calls.
    Returns TwiML with <Connect><Stream> to bridge to WebSocket.
    
    Query params:
        - lead_id: Lead UUID
        - token: HMAC signature for verification
    """
    form_data = await request.form()
    query_params = request.query_params
    
    lead_id_str = query_params.get("lead_id")
    token = query_params.get("token")
    
    if not lead_id_str or not token:
        logger.error("Missing lead_id or token in TwiML request")
        return _error_twiml("Invalid request")
    
    try:
        lead_id = UUID(lead_id_str)
    except ValueError:
        logger.error(f"Invalid lead_id format: {lead_id_str}")
        return _error_twiml("Invalid lead ID")
    
    # Verify token
    if not verify_lead_token(lead_id, token):
        logger.error(f"Invalid token for lead {lead_id}")
        return _error_twiml("Unauthorized")
    
    # Get call SID from Twilio
    call_sid = form_data.get("CallSid", "")
    from_number = form_data.get("From", "")
    to_number = form_data.get("To", "")
    
    logger.info(f"AI voice TwiML requested for lead {lead_id}, call {call_sid}")
    
    # Build WebSocket Stream URL with parameters
    # The WebSocket will receive lead_id, call_sid, and token
    ws_url = f"wss://{settings.backend_url.replace('https://', '').replace('http://', '')}/ws/twilio-ai"
    ws_url += f"?lead_id={lead_id}&call_sid={call_sid}&token={token}"
    
    # Generate TwiML with Stream
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="{ws_url}">
            <Parameter name="lead_id" value="{lead_id}" />
            <Parameter name="call_sid" value="{call_sid}" />
        </Stream>
    </Connect>
</Response>"""
    
    return FastAPIResponse(content=twiml, media_type="application/xml")


@router.post("/status")
async def ai_voice_status_callback(request: Request):
    """
    Status callback for AI voice calls.
    Updates AiOutboundCall and creates/updates CallLog.
    
    Twilio sends: CallSid, CallStatus, From, To, etc.
    """
    form_data = await request.form()
    
    call_sid = form_data.get("CallSid", "")
    call_status = form_data.get("CallStatus", "")
    from_number = form_data.get("From", "")
    to_number = form_data.get("To", "")
    call_duration = form_data.get("CallDuration")
    
    logger.info(f"AI voice status callback: {call_sid} -> {call_status}")
    
    # Get database session
    from app.db.database import get_engine_url_and_connect_args
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AsyncSessionType
    from sqlalchemy.orm import sessionmaker
    
    url, connect_args = get_engine_url_and_connect_args()
    engine = create_async_engine(url, echo=False, pool_pre_ping=True, connect_args=connect_args)
    async_session = sessionmaker(engine, class_=AsyncSessionType, expire_on_commit=False)
    
    async with async_session() as session:
        # Find AiOutboundCall by call_sid
        result = await session.execute(
            select(AiOutboundCall)
            .where(AiOutboundCall.twilio_call_sid == call_sid)
            .options(selectinload(AiOutboundCall.lead))
        )
        outbound_call = result.scalar_one_or_none()
        
        if not outbound_call:
            logger.warning(f"AiOutboundCall not found for call_sid {call_sid}")
            return {"status": "ok"}
        
        # Update status based on Twilio status
        status_map = {
            "initiated": "dialing",
            "ringing": "dialing",
            "in-progress": "in_progress",
            "completed": "completed",
            "busy": "failed",
            "no-answer": "failed",
            "failed": "failed",
            "canceled": "failed"
        }
        
        new_status = status_map.get(call_status, outbound_call.status)
        outbound_call.status = new_status
        
        if call_status in ("completed", "busy", "no-answer", "failed", "canceled"):
            outbound_call.completed_at = utc_now()
            if call_status == "no-answer":
                outbound_call.outcome = "no_answer"
            elif call_status == "busy":
                outbound_call.outcome = "busy"
            elif call_status == "failed":
                outbound_call.outcome = "failed"
        
        # Create or update CallLog
        if not outbound_call.call_log_id:
            call_log = CallLog(
                lead_id=outbound_call.lead_id,
                customer_id=outbound_call.lead.customer_id if outbound_call.lead else None,
                dealership_id=outbound_call.dealership_id,
                user_id=None,  # AI call, no user
                twilio_call_sid=call_sid,
                direction=CallDirection.OUTBOUND,
                from_number=from_number,
                to_number=to_number,
                status=CallStatus.INITIATED,
                started_at=utc_now()
            )
            session.add(call_log)
            await session.flush()
            outbound_call.call_log_id = call_log.id
        else:
            # Update existing
            result = await session.execute(
                select(CallLog).where(CallLog.id == outbound_call.call_log_id)
            )
            call_log = result.scalar_one_or_none()
            if call_log:
                # Map Twilio status to CallStatus enum
                if call_status == "completed":
                    call_log.status = CallStatus.COMPLETED
                    call_log.ended_at = utc_now()
                    if call_duration:
                        call_log.duration_seconds = int(call_duration)
                elif call_status == "in-progress":
                    call_log.status = CallStatus.IN_PROGRESS
                    call_log.answered_at = utc_now()
                elif call_status == "ringing":
                    call_log.status = CallStatus.RINGING
                elif call_status in ("busy", "no-answer", "failed"):
                    if call_status == "busy":
                        call_log.status = CallStatus.BUSY
                    elif call_status == "no-answer":
                        call_log.status = CallStatus.NO_ANSWER
                    else:
                        call_log.status = CallStatus.FAILED
                    call_log.ended_at = utc_now()
        
        await session.commit()
        logger.info(f"Updated AI outbound call {outbound_call.id} status to {new_status}")
    
    return {"status": "ok"}


def _error_twiml(message: str) -> FastAPIResponse:
    """Generate error TwiML that speaks a message and hangs up."""
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">We're sorry, we cannot complete your call at this time. Please try again later.</Say>
    <Hangup />
</Response>"""
    return FastAPIResponse(content=twiml, media_type="application/xml")
