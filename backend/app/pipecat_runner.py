"""
Pipecat AI Voice Pipeline Runner - Pipecat 1.0 (Python 3.13 Compatible)

SIMPLIFIED VERSION: Basic AI voice conversation without function calling.
This gets the AI voice working first, then we can add appointment booking later.
"""
import logging
import asyncio
import json
from typing import Optional, Dict, Any
from uuid import UUID

# Pipecat 1.0 imports
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.tts import OpenAITTSService

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.lead import Lead
from app.models.ai_outbound_call import AiOutboundCall
from app.services.ai_outbound_service import verify_lead_token

logger = logging.getLogger(__name__)


def build_system_prompt(lead: Lead, locale: str = "en-US") -> str:
    """Build the system prompt for the AI agent."""
    customer_name = lead.customer.first_name if lead.customer else "there"
    dealership_name = lead.dealership.name if lead.dealership else "our dealership"
    vehicle_context = f" about {lead.interested_in}" if lead.interested_in else ""
    
    if locale.startswith("hi"):
        greeting = "Namaste"
        style = "warm, respectful tone. You may code-mix Hindi and English naturally."
    elif locale.startswith("es"):
        greeting = "Hola"
        style = "friendly, professional Spanish"
    else:
        greeting = "Hello"
        style = "friendly, professional English"
    
    prompt = f"""You are a friendly automotive sales assistant calling {customer_name} on behalf of {dealership_name}. 
They recently expressed interest in visiting the dealership{vehicle_context}.

CONVERSATION GOALS:
1. Verify you're speaking with {customer_name}
2. Confirm their interest
3. Ask about their budget range (tactfully - offer ranges like "under 20k, 20-30k, 30-40k, or flexible")
4. Ask when they're looking to purchase (this week, this month, just browsing)
5. Ask if they have a trade-in vehicle
6. Offer to book a showroom appointment

GUIDELINES:
- Keep the call SHORT (2-3 minutes max)
- Be warm, professional, and efficient
- If not interested, thank them politely and end
- If they want to be removed from calls, apologize and say you'll update their preferences
- Sound natural and conversational, not robotic

TONE: Use a {style}.

OPENING: "{greeting}, this is calling from {dealership_name}. May I speak with {customer_name}?"
"""
    
    return prompt


async def run_ai_conversation(
    websocket: WebSocket,
    lead_id: UUID,
    call_sid: str,
    token: str,
    db_session: AsyncSession
) -> Dict[str, Any]:
    """
    Run the Pipecat AI conversation pipeline - Pipecat 1.0 Implementation.
    
    Args:
        websocket: FastAPI WebSocket connection
        lead_id: Lead UUID
        call_sid: Twilio Call SID
        token: Verification token
        db_session: Database session
        
    Returns:
        Dict with conversation outcome
    """
    # Verify token
    if not verify_lead_token(lead_id, token):
        logger.error(f"Invalid token for lead {lead_id}")
        await websocket.close(code=4003, reason="Unauthorized")
        return {"error": "unauthorized"}
    
    # Load lead context
    result = await db_session.execute(
        select(Lead)
        .where(Lead.id == lead_id)
        .options(
            selectinload(Lead.customer),
            selectinload(Lead.dealership)
        )
    )
    lead = result.scalar_one_or_none()
    
    if not lead or not lead.customer:
        logger.error(f"Lead {lead_id} or customer not found")
        await websocket.close(code=4004, reason="Lead not found")
        return {"error": "lead_not_found"}
    
    locale = (lead.meta_data or {}).get("locale", "en-US")
    
    logger.info(f"Starting AI conversation for lead {lead_id}, call {call_sid}, locale {locale}")
    
    try:
        # Check API keys
        if not settings.deepgram_api_key:
            raise ValueError("DEEPGRAM_API_KEY not configured")
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        
        # Build system prompt
        system_prompt = build_system_prompt(lead, locale)
        
        # Wait for Twilio's start message to get stream_sid
        raw_message = await websocket.receive_text()
        start_data = json.loads(raw_message)
        
        if start_data.get("event") != "start":
            logger.error(f"Expected 'start' event, got: {start_data.get('event')}")
            await websocket.close(code=4005, reason="Protocol error")
            return {"error": "protocol_error"}
        
        stream_sid = start_data.get("streamSid")
        if not stream_sid:
            logger.error("No streamSid in Twilio start message")
            await websocket.close(code=4006, reason="Missing streamSid")
            return {"error": "missing_stream_sid"}
        
        logger.info(f"Got Twilio stream SID: {stream_sid}")
        
        # Create Twilio serializer (Pipecat 1.0 API)
        serializer = TwilioFrameSerializer(
            stream_sid=stream_sid,
            call_sid=call_sid,
            account_sid=settings.twilio_account_sid,
            auth_token=settings.twilio_auth_token,
        )
        
        # Create FastAPI WebSocket transport (Pipecat 1.0)
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_out_enabled=True,
                add_wav_header=False,
                serializer=serializer,
            )
        )
        
        # Initialize services
        stt_service = DeepgramSTTService(
            api_key=settings.deepgram_api_key,
        )
        
        llm_service = OpenAILLMService(
            api_key=settings.openai_api_key,
            model="gpt-4o",
        )
        
        tts_service = OpenAITTSService(
            api_key=settings.openai_api_key,
            voice="alloy",
        )
        
        # Build the pipeline (Pipecat 1.0 style)
        pipeline = Pipeline([
            transport.input(),
            stt_service,
            llm_service,
            tts_service,
            transport.output(),
        ])
        
        # Set initial context
        messages = [{"role": "system", "content": system_prompt}]
        await llm_service.set_context(messages)
        
        # Update outbound call record
        outbound_result = await db_session.execute(
            select(AiOutboundCall).where(
                AiOutboundCall.lead_id == lead_id,
                AiOutboundCall.twilio_call_sid == call_sid
            )
        )
        outbound_call = outbound_result.scalar_one_or_none()
        if outbound_call:
            outbound_call.status = "in_progress"
            outbound_call.notes = "AI conversation started (Pipecat 1.0)"
            await db_session.commit()
        
        # Run the pipeline
        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                allow_interruptions=True,
                audio_in_sample_rate=8000,  # Twilio uses 8kHz
                audio_out_sample_rate=8000,
            )
        )
        
        logger.info(f"Pipeline started for lead {lead_id}")
        await task.run()
        logger.info(f"Pipeline completed for lead {lead_id}")
        
        # Update final status
        if outbound_call:
            outbound_call.status = "completed"
            outbound_call.completed_at = utc_now()
            outbound_call.outcome = "completed"
            outbound_call.notes = f"AI call completed successfully"
            await db_session.commit()
        
        return {
            "status": "completed",
        }
        
    except Exception as e:
        logger.error(f"AI conversation error for lead {lead_id}: {e}", exc_info=True)
        
        # Update as failed
        try:
            outbound_result = await db_session.execute(
                select(AiOutboundCall).where(
                    AiOutboundCall.lead_id == lead_id,
                    AiOutboundCall.twilio_call_sid == call_sid
                )
            )
            outbound_call = outbound_result.scalar_one_or_none()
            if outbound_call:
                outbound_call.status = "failed"
                outbound_call.completed_at = utc_now()
                outbound_call.notes = f"Error: {str(e)}"
                await db_session.commit()
        except:
            pass
        
        return {"error": str(e)}
