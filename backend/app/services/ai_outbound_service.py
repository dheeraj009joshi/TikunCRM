"""
AI Outbound Calling Service

Handles automatic outbound AI calls to new leads for qualification and appointment booking.
"""
import logging
import hmac
import hashlib
from datetime import datetime, time
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import pytz

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.dealership import Dealership
from app.models.ai_outbound_call import AiOutboundCall
from app.services.sms_service import SMSService
from app.services.dealership_twilio_config_service import get_effective_twilio_config

logger = logging.getLogger(__name__)


def _is_in_quiet_hours(dealership_timezone: str, quiet_start_hour: int, quiet_end_hour: int) -> bool:
    """
    Check if current local time is within quiet hours.
    
    Args:
        dealership_timezone: IANA timezone (e.g. "America/New_York")
        quiet_start_hour: Start of quiet hours (e.g. 21 for 9 PM)
        quiet_end_hour: End of quiet hours (e.g. 9 for 9 AM)
    
    Returns:
        True if in quiet hours, False otherwise
    """
    try:
        tz = pytz.timezone(dealership_timezone)
    except pytz.UnknownTimeZoneError:
        logger.warning(f"Unknown timezone {dealership_timezone}, using UTC")
        tz = pytz.UTC
    
    local_now = datetime.now(tz)
    current_hour = local_now.hour
    
    # Handle cases where quiet hours cross midnight
    if quiet_start_hour < quiet_end_hour:
        # Normal range (e.g. 2 AM to 8 AM)
        return quiet_start_hour <= current_hour < quiet_end_hour
    else:
        # Crosses midnight (e.g. 9 PM to 9 AM)
        return current_hour >= quiet_start_hour or current_hour < quiet_end_hour


def generate_lead_token(lead_id: UUID) -> str:
    """
    Generate an HMAC token for secure lead identification in webhooks.
    
    Args:
        lead_id: Lead UUID
        
    Returns:
        HMAC signature as hex string
    """
    message = str(lead_id).encode('utf-8')
    signature = hmac.new(
        settings.secret_key.encode('utf-8'),
        message,
        hashlib.sha256
    ).hexdigest()
    return signature


def verify_lead_token(lead_id: UUID, token: str) -> bool:
    """
    Verify an HMAC token for a lead.
    
    Args:
        lead_id: Lead UUID
        token: HMAC signature to verify
        
    Returns:
        True if valid, False otherwise
    """
    expected_token = generate_lead_token(lead_id)
    return hmac.compare_digest(expected_token, token)


async def maybe_enqueue_ai_outbound(db: AsyncSession, lead_id: UUID) -> Optional[str]:
    """
    Check if AI outbound call should be placed for this lead and create tracking record.
    This is the central hook called from all lead creation paths.
    
    Gates checked:
    1. Global kill switch (AI_OUTBOUND_ENABLED)
    2. Lead has dealership_id
    3. Dealership has ai_outbound_enabled
    4. Lead has valid phone number
    5. Not already attempted for this lead (idempotency)
    6. Not in quiet hours
    7. Twilio voice configured
    
    Args:
        db: Database session
        lead_id: Lead UUID
        
    Returns:
        Status string or None if call should not be placed
    """
    # Gate 1: Global kill switch
    if not settings.ai_outbound_enabled:
        logger.debug(f"AI outbound disabled globally for lead {lead_id}")
        return "skipped_global_disabled"
    
    # Load lead with customer and dealership
    result = await db.execute(
        select(Lead)
        .where(Lead.id == lead_id)
        .options(
            selectinload(Lead.customer),
            selectinload(Lead.dealership)
        )
    )
    lead = result.scalar_one_or_none()
    
    if not lead:
        logger.error(f"Lead {lead_id} not found")
        return "error_lead_not_found"
    
    # Gate 2: Lead has dealership
    if not lead.dealership_id:
        logger.debug(f"Lead {lead_id} has no dealership, skipping AI outbound")
        return "skipped_no_dealership"
    
    # Gate 3: Check if dealership has AI outbound enabled
    effective_config = await get_effective_twilio_config(db, lead.dealership_id)
    
    # Check dealership-level toggle (from dealership_twilio_configs)
    dealership_config_result = await db.execute(
        select(DealershipTwilioConfig)
        .where(DealershipTwilioConfig.dealership_id == lead.dealership_id)
    )
    dealership_config = dealership_config_result.scalar_one_or_none()
    
    if not dealership_config or not dealership_config.ai_outbound_enabled:
        logger.debug(f"AI outbound disabled for dealership {lead.dealership_id}")
        return "skipped_dealership_disabled"
    
    # Gate 4: Valid phone number
    customer_phone = lead.customer.phone if lead.customer else None
    if not customer_phone:
        logger.debug(f"Lead {lead_id} has no phone number")
        await _create_outbound_record(db, lead_id, lead.dealership_id, "skipped_no_phone", None)
        return "skipped_no_phone"
    
    # Normalize phone
    sms_service = SMSService()
    normalized_phone = sms_service.format_phone_number(customer_phone)
    if not normalized_phone:
        logger.debug(f"Lead {lead_id} has invalid phone format: {customer_phone}")
        await _create_outbound_record(db, lead_id, lead.dealership_id, "skipped_invalid_phone", customer_phone)
        return "skipped_invalid_phone"
    
    # Gate 5: Idempotency - check if already attempted
    existing_result = await db.execute(
        select(AiOutboundCall).where(AiOutboundCall.lead_id == lead_id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        logger.debug(f"AI outbound already attempted for lead {lead_id}, status: {existing.status}")
        return f"duplicate_{existing.status}"
    
    # Gate 6: Quiet hours check
    dealership_timezone = lead.dealership.timezone if lead.dealership else "UTC"
    if _is_in_quiet_hours(
        dealership_timezone,
        settings.ai_outbound_quiet_hours_start,
        settings.ai_outbound_quiet_hours_end
    ):
        logger.info(f"Lead {lead_id} in quiet hours for timezone {dealership_timezone}")
        await _create_outbound_record(db, lead_id, lead.dealership_id, "skipped_quiet_hours", normalized_phone)
        return "skipped_quiet_hours"
    
    # Gate 7: Twilio configured
    if not effective_config.is_voice_ready():
        logger.warning(f"Twilio voice not configured for dealership {lead.dealership_id}")
        await _create_outbound_record(db, lead_id, lead.dealership_id, "skipped_no_twilio", normalized_phone)
        return "skipped_no_twilio"
    
    # All gates passed - create pending record
    await _create_outbound_record(db, lead_id, lead.dealership_id, "pending", normalized_phone)
    await db.commit()
    
    logger.info(f"Enqueued AI outbound call for lead {lead_id}, phone {normalized_phone}")
    return "pending"


async def _create_outbound_record(
    db: AsyncSession,
    lead_id: UUID,
    dealership_id: UUID,
    status: str,
    phone: Optional[str]
) -> AiOutboundCall:
    """Helper to create ai_outbound_calls record."""
    record = AiOutboundCall(
        lead_id=lead_id,
        dealership_id=dealership_id,
        status=status,
        customer_phone=phone,
        scheduled_at=utc_now() if status == "pending" else None
    )
    db.add(record)
    await db.flush()
    return record


async def initiate_twilio_call(db: AsyncSession, ai_outbound_call_id: UUID) -> bool:
    """
    Initiate the actual Twilio call for a pending AI outbound call.
    This should be called from a background task.
    
    Args:
        db: Database session
        ai_outbound_call_id: AiOutboundCall UUID
        
    Returns:
        True if call initiated successfully
    """
    # Load the outbound call record
    result = await db.execute(
        select(AiOutboundCall)
        .where(AiOutboundCall.id == ai_outbound_call_id)
        .options(selectinload(AiOutboundCall.lead))
    )
    outbound_call = result.scalar_one_or_none()
    
    if not outbound_call:
        logger.error(f"AiOutboundCall {ai_outbound_call_id} not found")
        return False
    
    if outbound_call.status != "pending":
        logger.warning(f"AiOutboundCall {ai_outbound_call_id} not in pending status: {outbound_call.status}")
        return False
    
    # Get Twilio config
    effective_config = await get_effective_twilio_config(db, outbound_call.dealership_id)
    
    if not effective_config.is_voice_ready():
        logger.error(f"Twilio not configured for dealership {outbound_call.dealership_id}")
        outbound_call.status = "failed"
        outbound_call.notes = "Twilio voice not configured"
        outbound_call.completed_at = utc_now()
        await db.commit()
        return False
    
    try:
        from twilio.rest import Client
        
        # Create Twilio client
        client = Client(effective_config.account_sid, effective_config.auth_token)
        
        # Generate secure token for webhook
        lead_token = generate_lead_token(outbound_call.lead_id)
        
        # Build webhook URLs
        twiml_url = f"{settings.backend_url}/api/v1/webhooks/twilio/ai-voice/twiml?lead_id={outbound_call.lead_id}&token={lead_token}"
        status_callback_url = f"{settings.backend_url}/api/v1/webhooks/twilio/ai-voice/status"
        
        # Initiate call
        call = client.calls.create(
            to=outbound_call.customer_phone,
            from_=effective_config.voice_caller_id_number or settings.twilio_phone_number,
            url=twiml_url,
            status_callback=status_callback_url,
            status_callback_event=['initiated', 'ringing', 'answered', 'completed'],
            status_callback_method='POST'
        )
        
        # Update record
        outbound_call.status = "dialing"
        outbound_call.twilio_call_sid = call.sid
        outbound_call.started_at = utc_now()
        await db.commit()
        
        logger.info(f"Initiated Twilio call {call.sid} for lead {outbound_call.lead_id}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to initiate Twilio call for {ai_outbound_call_id}: {e}", exc_info=True)
        outbound_call.status = "failed"
        outbound_call.notes = f"Twilio error: {str(e)}"
        outbound_call.completed_at = utc_now()
        await db.commit()
        return False


# Import here to avoid circular dependency
from app.models.dealership_twilio_config import DealershipTwilioConfig
from sqlalchemy.orm import selectinload
