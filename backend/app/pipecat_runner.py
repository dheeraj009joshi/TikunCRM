"""
Pipecat AI Voice Pipeline Runner - Phase B

Handles real-time AI voice conversations for lead qualification and appointment booking.
Uses Pipecat framework with Twilio Media Streams, Deepgram STT, OpenAI LLM, and Cartesia TTS.
"""
import logging
import asyncio
import json
from typing import Optional, Dict, Any, List
from uuid import UUID
from datetime import datetime, timedelta
import pytz

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.processors.aggregators.llm_response import (
    LLMAssistantResponseAggregator,
    LLMUserResponseAggregator
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.frames.frames import (
    Frame,
    TextFrame,
    TranscriptionFrame,
    LLMMessagesFrame,
    EndFrame,
    FunctionCallFrame,
    FunctionCallResultFrame,
)
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.network.websocket_server import WebsocketServerTransport, WebsocketServerParams
from pipecat.vad.silero import SileroVADAnalyzer

# Import Pipecat services
from pipecat.services.deepgram import DeepgramSTTService
from pipecat.services.openai import OpenAILLMService
try:
    from pipecat.services.cartesia import CartesiaTTSService
    CARTESIA_AVAILABLE = True
except ImportError:
    CARTESIA_AVAILABLE = False
    logger.warning("Cartesia TTS not available, will use OpenAI TTS")

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.lead import Lead
from app.models.dealership import Dealership
from app.models.appointment import Appointment, AppointmentType, AppointmentStatus
from app.models.activity import Activity, ActivityType
from app.models.ai_outbound_call import AiOutboundCall
from app.services.ai_outbound_service import verify_lead_token

logger = logging.getLogger(__name__)


class LeadContext:
    """Context holder for lead data during conversation."""
    def __init__(
        self,
        lead_id: UUID,
        customer_name: str,
        customer_phone: str,
        dealership_name: str,
        dealership_timezone: str,
        interested_in: Optional[str],
        locale: str = "en-US",
        db_session: AsyncSession = None
    ):
        self.lead_id = lead_id
        self.customer_name = customer_name
        self.customer_phone = customer_phone
        self.dealership_name = dealership_name
        self.dealership_timezone = dealership_timezone
        self.interested_in = interested_in
        self.locale = locale
        self.db_session = db_session
        
        # Conversation state
        self.qualified = False
        self.appointment_requested = False
        self.appointment_time: Optional[datetime] = None
        self.qualification_notes: Dict[str, Any] = {}
        self.conversation_transcript: List[str] = []


class FunctionCallHandler(FrameProcessor):
    """
    Processor that handles function calls from the LLM for appointment booking and qualification.
    """
    def __init__(self, lead_context: LeadContext):
        super().__init__()
        self.lead_context = lead_context
        self.functions = {
            "qualify_lead": self._qualify_lead,
            "book_appointment": self._book_appointment,
            "check_availability": self._check_availability,
        }
    
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Process frames and handle function calls from LLM."""
        await super().process_frame(frame, direction)
        
        if isinstance(frame, FunctionCallFrame):
            function_name = frame.function_name
            arguments = frame.arguments
            
            logger.info(f"Function call: {function_name} with args: {arguments}")
            
            if function_name in self.functions:
                try:
                    result = await self.functions[function_name](arguments)
                    # Send result back to LLM
                    result_frame = FunctionCallResultFrame(
                        function_name=function_name,
                        result=result
                    )
                    await self.push_frame(result_frame, direction)
                except Exception as e:
                    logger.error(f"Function call error: {e}", exc_info=True)
                    error_result = FunctionCallResultFrame(
                        function_name=function_name,
                        result={"error": str(e)}
                    )
                    await self.push_frame(error_result, direction)
        
        return frame
    
    async def _qualify_lead(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Qualify the lead with budget, timeframe, and trade-in info.
        
        Args from LLM:
            budget_range: str (e.g. "20000-30000")
            timeframe: str (e.g. "within_week", "this_month", "just_looking")
            has_trade_in: bool
            trade_in_details: Optional[str]
        """
        self.lead_context.qualified = True
        self.lead_context.qualification_notes = {
            "budget_range": args.get("budget_range"),
            "timeframe": args.get("timeframe"),
            "has_trade_in": args.get("has_trade_in", False),
            "trade_in_details": args.get("trade_in_details"),
            "qualified_at": datetime.utcnow().isoformat()
        }
        
        logger.info(f"Lead {self.lead_context.lead_id} qualified: {self.lead_context.qualification_notes}")
        
        return {
            "success": True,
            "message": "Lead qualification recorded successfully"
        }
    
    async def _check_availability(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Check appointment availability for given date/time.
        
        Args from LLM:
            date: str (YYYY-MM-DD)
            time: str (HH:MM in 24h format)
        """
        try:
            date_str = args.get("date")
            time_str = args.get("time")
            
            if not date_str or not time_str:
                return {"available": False, "error": "Date and time required"}
            
            # Parse and validate time
            tz = pytz.timezone(self.lead_context.dealership_timezone)
            dt_naive = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
            dt_local = tz.localize(dt_naive)
            
            # Basic availability check (weekdays 9-18, Sat 10-16)
            weekday = dt_local.weekday()
            hour = dt_local.hour
            
            if weekday < 5:  # Monday-Friday
                available = 9 <= hour < 18
            elif weekday == 5:  # Saturday
                available = 10 <= hour < 16
            else:  # Sunday
                available = False
            
            # Check if in the future
            now_local = datetime.now(tz)
            if dt_local <= now_local:
                available = False
            
            return {
                "available": available,
                "datetime": dt_local.isoformat(),
                "message": "Available" if available else "Time slot not available"
            }
        
        except Exception as e:
            logger.error(f"Availability check error: {e}")
            return {"available": False, "error": str(e)}
    
    async def _book_appointment(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Book an appointment for the lead.
        
        Args from LLM:
            date: str (YYYY-MM-DD)
            time: str (HH:MM)
            notes: Optional[str]
        """
        try:
            date_str = args.get("date")
            time_str = args.get("time")
            notes = args.get("notes", "")
            
            if not date_str or not time_str:
                return {"success": False, "error": "Date and time required"}
            
            # Parse datetime in dealership timezone
            tz = pytz.timezone(self.lead_context.dealership_timezone)
            dt_naive = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
            dt_local = tz.localize(dt_naive)
            dt_utc = dt_local.astimezone(pytz.UTC)
            
            # Create appointment
            appointment = await create_appointment_for_lead(
                self.lead_context.db_session,
                self.lead_context.lead_id,
                dt_utc.replace(tzinfo=None),  # Store as naive UTC in DB
                f"{notes}. Qualification: {json.dumps(self.lead_context.qualification_notes)}"
            )
            
            if appointment:
                self.lead_context.appointment_requested = True
                self.lead_context.appointment_time = dt_utc.replace(tzinfo=None)
                
                return {
                    "success": True,
                    "appointment_id": str(appointment.id),
                    "scheduled_at": dt_local.strftime("%A, %B %d at %I:%M %p"),
                    "message": "Appointment booked successfully"
                }
            else:
                return {"success": False, "error": "Failed to create appointment"}
        
        except Exception as e:
            logger.error(f"Appointment booking error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}


async def create_appointment_for_lead(
    db: AsyncSession,
    lead_id: UUID,
    scheduled_at: datetime,
    notes: str
) -> Optional[Appointment]:
    """
    Create an appointment for the lead (called by AI as a tool).
    
    Args:
        db: Database session
        lead_id: Lead UUID
        scheduled_at: Appointment datetime
        notes: Any notes from the conversation
        
    Returns:
        Created Appointment or None on failure
    """
    try:
        # Load lead
        result = await db.execute(
            select(Lead).where(Lead.id == lead_id)
        )
        lead = result.scalar_one_or_none()
        
        if not lead:
            logger.error(f"Lead {lead_id} not found for appointment booking")
            return None
        
        # Create appointment
        appointment = Appointment(
            lead_id=lead_id,
            dealership_id=lead.dealership_id,
            assigned_to=lead.assigned_to,
            scheduled_by=None,  # AI system
            title=f"Showroom visit - {lead.first_name}",
            description=f"AI scheduled appointment. {notes}",
            appointment_type=AppointmentType.IN_PERSON,
            status=AppointmentStatus.SCHEDULED,
            scheduled_at=scheduled_at,
            duration_minutes=60
        )
        db.add(appointment)
        await db.flush()
        
        # Log activity
        activity = Activity(
            type=ActivityType.APPOINTMENT_SCHEDULED,
            description=f"AI voice agent scheduled showroom appointment for {scheduled_at.strftime('%Y-%m-%d %I:%M %p')}",
            user_id=None,
            lead_id=lead_id,
            dealership_id=lead.dealership_id,
            meta_data={
                "appointment_id": str(appointment.id),
                "scheduled_by": "ai_voice",
                "notes": notes
            }
        )
        db.add(activity)
        await db.commit()
        
        logger.info(f"AI created appointment {appointment.id} for lead {lead_id}")
        return appointment
        
    except Exception as e:
        logger.error(f"Failed to create AI appointment for lead {lead_id}: {e}", exc_info=True)
        await db.rollback()
        return None


def get_function_definitions() -> List[Dict[str, Any]]:
    """
    Get OpenAI function definitions for the LLM to use.
    """
    return [
        {
            "name": "qualify_lead",
            "description": "Record lead qualification information including budget, timeframe, and trade-in details",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_range": {
                        "type": "string",
                        "description": "Customer's budget range, e.g. '20000-30000' or 'under_15000' or 'flexible'"
                    },
                    "timeframe": {
                        "type": "string",
                        "enum": ["within_week", "this_month", "next_month", "just_looking", "urgent"],
                        "description": "When the customer wants to make a purchase"
                    },
                    "has_trade_in": {
                        "type": "boolean",
                        "description": "Whether customer has a vehicle to trade in"
                    },
                    "trade_in_details": {
                        "type": "string",
                        "description": "Details about trade-in vehicle (make, model, year, condition)"
                    }
                },
                "required": ["budget_range", "timeframe", "has_trade_in"]
            }
        },
        {
            "name": "check_availability",
            "description": "Check if a specific date and time is available for an appointment",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date in YYYY-MM-DD format"
                    },
                    "time": {
                        "type": "string",
                        "description": "Time in HH:MM format (24-hour), e.g. '14:00' for 2 PM"
                    }
                },
                "required": ["date", "time"]
            }
        },
        {
            "name": "book_appointment",
            "description": "Book a showroom appointment for the customer at a confirmed date and time",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date in YYYY-MM-DD format"
                    },
                    "time": {
                        "type": "string",
                        "description": "Time in HH:MM format (24-hour)"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any special notes or customer preferences for the appointment"
                    }
                },
                "required": ["date", "time"]
            }
        }
    ]


def build_system_prompt(lead_context: LeadContext) -> str:
    """
    Build the system prompt for the AI agent based on lead context.
    
    Args:
        lead_context: Lead information
        
    Returns:
        System prompt string
    """
    # Locale-specific greetings and style
    if lead_context.locale.startswith("hi"):
        greeting = "Namaste"
        style = "warm, respectful tone appropriate for Hindi speakers. You may code-mix Hindi and English naturally."
        language_note = "Feel free to switch between Hindi and English based on customer preference."
    elif lead_context.locale.startswith("es"):
        greeting = "Hola"
        style = "friendly, professional Spanish"
        language_note = "Conduct the conversation in Spanish."
    else:
        greeting = "Hello"
        style = "friendly, professional English with American accent"
        language_note = ""
    
    vehicle_context = f" about {lead_context.interested_in}" if lead_context.interested_in else ""
    
    prompt = f"""You are a friendly automotive sales assistant calling {lead_context.customer_name} on behalf of {lead_context.dealership_name}. 
They recently expressed interest in visiting the dealership{vehicle_context}.

CONVERSATION GOALS (in order):
1. Verify you're speaking with {lead_context.customer_name}
2. Confirm their interest and reason for inquiry
3. Qualify the lead:
   - Budget range (be tactful, offer ranges)
   - Timeframe for purchase
   - Trade-in vehicle (if any)
4. Book a showroom appointment at their preferred time

CONVERSATION GUIDELINES:
- Keep the call SHORT (2-3 minutes max)
- Be warm, professional, and efficient
- Listen actively and don't interrupt
- If not interested, thank them politely and end the call
- If they ask to be removed from calls, apologize and confirm you'll update their preferences, then end call
- If they want a callback, offer to have a human sales representative call them back

APPOINTMENT SCHEDULING:
- Available hours: Monday-Friday 9 AM - 6 PM, Saturday 10 AM - 4 PM (closed Sunday)
- Always use check_availability before booking
- Confirm the date and time clearly before finalizing
- After booking, confirm again: "Perfect! I've scheduled you for [day], [date] at [time]. You'll receive a confirmation shortly."

FUNCTIONS YOU CAN USE:
1. qualify_lead() - Record budget, timeframe, trade-in info
2. check_availability(date, time) - Verify time slot is available  
3. book_appointment(date, time, notes) - Book the appointment

TONE & STYLE:
Use a {style}. {language_note}

OPENING LINE:
"{greeting}, this is calling from {lead_context.dealership_name}. May I speak with {lead_context.customer_name}?"

IMPORTANT: 
- Never make up availability - always check first
- Qualify the lead BEFORE booking appointment
- Be respectful if they're busy - offer to call back
"""
    
    return prompt


async def run_ai_conversation(
    websocket,
    lead_id: UUID,
    call_sid: str,
    token: str,
    db_session: AsyncSession
) -> Dict[str, Any]:
    """
    Run the Pipecat AI conversation pipeline - Phase B (Full Implementation).
    
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
    
    # Determine locale (check lead meta_data first, then default)
    locale = (lead.meta_data or {}).get("locale", "en-US")
    
    lead_context = LeadContext(
        lead_id=lead_id,
        customer_name=lead.customer.first_name,
        customer_phone=lead.customer.phone or "",
        dealership_name=lead.dealership.name if lead.dealership else "our dealership",
        dealership_timezone=lead.dealership.timezone if lead.dealership else "UTC",
        interested_in=lead.interested_in,
        locale=locale,
        db_session=db_session
    )
    
    logger.info(f"Starting AI conversation for lead {lead_id}, call {call_sid}, locale {locale}")
    
    try:
        # Check API keys
        if not settings.deepgram_api_key:
            raise ValueError("DEEPGRAM_API_KEY not configured")
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        if not settings.cartesia_api_key and not CARTESIA_AVAILABLE:
            logger.warning("Cartesia not available, will use OpenAI TTS")
        
        # Build system prompt and function definitions
        system_prompt = build_system_prompt(lead_context)
        functions = get_function_definitions()
        
        # Initialize Pipecat services
        # 1. STT - Deepgram
        stt_service = DeepgramSTTService(
            api_key=settings.deepgram_api_key,
            url="https://api.deepgram.com/v1/listen",
            encoding="linear16",
            sample_rate=8000,  # Twilio uses 8kHz
            language=locale.split("-")[0] if locale else "en",  # e.g. "en" from "en-US"
            model="nova-2",
        )
        
        # 2. LLM - OpenAI with function calling
        llm_service = OpenAILLMService(
            api_key=settings.openai_api_key,
            model="gpt-4",  # or gpt-4-turbo for faster/cheaper
            messages=[
                {"role": "system", "content": system_prompt}
            ],
            functions=functions,
        )
        
        # 3. TTS - Cartesia or OpenAI
        if CARTESIA_AVAILABLE and settings.cartesia_api_key:
            # Map locales to Cartesia voices
            voice_map = {
                "en-US": "79a125e8-cd45-4c13-8a67-188112f4dd22",  # American male
                "en-IN": "79a125e8-cd45-4c13-8a67-188112f4dd22",  # Use US voice for now
                "es-US": "846d6cb0-2301-48b6-9683-48f5618ea2f6",  # Spanish male
                "hi-IN": "79a125e8-cd45-4c13-8a67-188112f4dd22",  # Fallback to English
            }
            tts_service = CartesiaTTSService(
                api_key=settings.cartesia_api_key,
                voice_id=voice_map.get(locale, voice_map["en-US"]),
                model="sonic-english",  # or sonic-multilingual
                encoding="pcm_mulaw",
                sample_rate=8000,
            )
        else:
            # Fallback to OpenAI TTS
            from pipecat.services.openai import OpenAITTSService
            voice_map = {
                "en-US": "alloy",
                "en-IN": "alloy",
                "es-US": "nova",
                "hi-IN": "alloy",
            }
            tts_service = OpenAITTSService(
                api_key=settings.openai_api_key,
                voice=voice_map.get(locale, "alloy"),
            )
        
        # 4. VAD - Voice Activity Detection
        vad = SileroVADAnalyzer()
        
        # 5. Function call handler
        function_handler = FunctionCallHandler(lead_context)
        
        # 6. Aggregators for managing conversation flow
        user_aggregator = LLMUserResponseAggregator()
        assistant_aggregator = LLMAssistantResponseAggregator()
        
        # 7. Twilio transport
        transport = WebsocketServerTransport(
            websocket=websocket,
            params=WebsocketServerParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                vad_enabled=True,
                vad_analyzer=vad,
                vad_audio_passthrough=True,
                serializer=TwilioFrameSerializer(
                    stream_sid=call_sid,  # Twilio stream SID
                )
            )
        )
        
        # Build the pipeline
        pipeline = Pipeline([
            transport.input(),  # Twilio audio in
            stt_service,  # Speech to text
            user_aggregator,  # Aggregate user messages
            llm_service,  # LLM processes and may call functions
            function_handler,  # Handle function calls
            assistant_aggregator,  # Aggregate assistant responses
            tts_service,  # Text to speech
            transport.output(),  # Twilio audio out
        ])
        
        # Update outbound call record to in_progress
        outbound_result = await db_session.execute(
            select(AiOutboundCall).where(
                AiOutboundCall.lead_id == lead_id,
                AiOutboundCall.twilio_call_sid == call_sid
            )
        )
        outbound_call = outbound_result.scalar_one_or_none()
        if outbound_call:
            outbound_call.status = "in_progress"
            outbound_call.notes = "AI conversation started (Phase B)"
            await db_session.commit()
        
        # Run the pipeline
        task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))
        runner = PipelineRunner()
        
        logger.info(f"Pipeline started for lead {lead_id}")
        await runner.run(task)
        logger.info(f"Pipeline completed for lead {lead_id}")
        
        # Update final status
        if outbound_call:
            outbound_call.status = "completed"
            outbound_call.completed_at = utc_now()
            outbound_call.outcome = "booked" if lead_context.appointment_requested else "qualified" if lead_context.qualified else "completed"
            outbound_call.notes = f"Call completed. Qualified: {lead_context.qualified}, Appointment: {lead_context.appointment_requested}"
            outbound_call.meta_data = {
                "qualification": lead_context.qualification_notes,
                "appointment_time": lead_context.appointment_time.isoformat() if lead_context.appointment_time else None,
            }
            await db_session.commit()
        
        return {
            "status": "completed",
            "qualified": lead_context.qualified,
            "appointment_booked": lead_context.appointment_requested,
            "appointment_time": lead_context.appointment_time.isoformat() if lead_context.appointment_time else None,
            "qualification": lead_context.qualification_notes
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
