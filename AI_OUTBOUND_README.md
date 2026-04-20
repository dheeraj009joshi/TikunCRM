# AI Outbound Calling

Automated AI voice calls to new leads for qualification and appointment booking.

## Overview

When a new lead is created, the system can automatically place an outbound phone call using AI to:
- Confirm the lead's interest
- Qualify their needs (budget, timeframe, trade-in)
- Book a showroom appointment

The system uses:
- **Twilio** for telephony (PSTN outbound calls)
- **Pipecat** for real-time audio pipeline orchestration
- **Deepgram** for speech-to-text (STT)
- **OpenAI** for conversation logic (LLM)
- **Cartesia or ElevenLabs** for text-to-speech (TTS)

## Feature Flags

AI outbound calling is **disabled by default** at multiple levels:

1. **Global kill switch**: `AI_OUTBOUND_ENABLED=false` (in `.env`)
2. **Per-dealership toggle**: `ai_outbound_enabled=false` in `dealership_twilio_configs`

Both must be `true` for calls to be placed.

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Global AI Outbound Control
AI_OUTBOUND_ENABLED=false

# Quiet Hours (local time, 24-hour format)
AI_OUTBOUND_QUIET_HOURS_START=21  # 9 PM
AI_OUTBOUND_QUIET_HOURS_END=9     # 9 AM

# Optional: System user UUID for attribution
AI_VOICE_SYSTEM_USER_ID=

# API Keys
DEEPGRAM_API_KEY=your_deepgram_key
OPENAI_API_KEY=your_openai_key
CARTESIA_API_KEY=your_cartesia_key  # or ELEVENLABS_API_KEY
```

### Database Migration

Run the migration to add required tables and fields:

```bash
cd backend
alembic upgrade head
```

This creates:
- `ai_outbound_calls` table for tracking call attempts
- `ai_outbound_enabled` column in `dealership_twilio_configs`

### Per-Dealership Toggle

Admins can enable AI outbound for a dealership via API:

```bash
PATCH /api/v1/dealerships/{dealership_id}/twilio-config
{
  "ai_outbound_enabled": true
}
```

**Note**: Requires X-Config-Unlock-Token header (same auth as other Twilio config).

## How It Works

### Call Flow

```
Lead Created
    ↓
maybe_enqueue_ai_outbound() - checks gates
    ↓
Create ai_outbound_calls record (status=pending)
    ↓
initiate_twilio_call() - Twilio REST API
    ↓
Twilio dials customer
    ↓
TwiML returns <Connect><Stream> → WebSocket
    ↓
Pipecat pipeline: Deepgram STT → OpenAI LLM → Cartesia TTS
    ↓
LLM calls functions:
  - qualify_lead(budget, timeframe, trade_in)
  - check_availability(date, time)
  - book_appointment(date, time, notes)
    ↓
Update ai_outbound_calls + create Appointment + Activity
```

### AI Functions

The AI agent has access to three functions it can call during the conversation:

1. **`qualify_lead(budget_range, timeframe, has_trade_in, trade_in_details)`**
   - Records customer's budget, purchase timeframe, and trade-in info
   - Stores in `ai_outbound_calls.meta_data`

2. **`check_availability(date, time)`**
   - Validates appointment time slot availability
   - Checks business hours (Mon-Fri 9-6, Sat 10-4)
   - Ensures time is in the future

3. **`book_appointment(date, time, notes)`**
   - Creates `Appointment` record in database
   - Links to lead and dealership
   - Logs activity with AI attribution
   - Includes qualification notes

The LLM decides when to call these functions based on the conversation flow.

### Gates (Idempotency & Safety)

Before dialing, the system checks:

1. ✅ Global `AI_OUTBOUND_ENABLED` flag
2. ✅ Lead has a dealership
3. ✅ Dealership has `ai_outbound_enabled=true`
4. ✅ Lead has a valid phone number (E.164 format)
5. ✅ No prior AI call for this lead (unique constraint on `lead_id`)
6. ✅ Not in quiet hours (per dealership timezone)
7. ✅ Twilio voice is configured

If any gate fails, the system logs the reason and skips the call.

### Quiet Hours

Calls are **not placed** during quiet hours (default 9 PM – 9 AM local time).

The system uses the dealership's timezone from `dealerships.timezone`.

To customize quiet hours per dealership, you can extend the config later (currently global via env vars).

## Integration Points

AI outbound calls are triggered automatically when leads are created via:

- `POST /api/v1/leads` (manual lead creation)
- Meta Lead Ads webhook (`IntegrationService.process_meta_lead`)
- Google Sheets sync (`google_sheets_sync.py`)

Each path calls `maybe_enqueue_ai_outbound(db, lead_id)` after the lead is committed.

## Monitoring & Observability

### Database Tables

- **`ai_outbound_calls`**: Tracks every AI call attempt
  - `status`: pending, dialing, in_progress, completed, failed, skipped_*
  - `outcome`: qualified, booked, no_answer, voicemail, customer_declined, etc.
  - `notes`: AI summary or error details
  - `meta_data`: Qualification fields, appointment details

- **`call_logs`**: Standard call history (linked via `call_log_id`)

- **`appointments`**: Booked appointments (linked via `lead_id`)

### Logs

All AI call events are logged with:

```python
logger.info(f"Enqueued AI outbound call for lead {lead_id}, phone {phone}")
logger.error(f"Failed to initiate Twilio call: {error}")
```

Search logs for `"AI outbound"` or `"ai_outbound"`.

## Phased Implementation

The codebase implements **Phase B** (full conversation):

- ✅ Database schema and models
- ✅ Enqueue logic with all gates
- ✅ Twilio REST dial + TwiML webhooks
- ✅ Status callbacks → CallLog
- ✅ WebSocket endpoint for Pipecat
- ✅ **Phase B (conversation)**: Full Pipecat pipeline with STT/LLM/TTS
- ✅ Deepgram STT integration
- ✅ OpenAI LLM with function calling (3 functions)
- ✅ Cartesia TTS (with OpenAI TTS fallback)
- ✅ Voice Activity Detection (Silero VAD)
- ✅ Multilingual support (en-US, en-IN, hi-IN, es-US)

### Production Ready

The system is ready for testing with real calls:

1. All STT/LLM/TTS services fully integrated
2. Function calling for qualification and booking operational
3. Appointment creation writes to database
4. Activity logging tracks AI actions
5. Comprehensive error handling and status tracking

### Testing Checklist

- [ ] Configure all API keys in `.env`
- [ ] Enable global flag: `AI_OUTBOUND_ENABLED=true`
- [ ] Enable for test dealership via API
- [ ] Create test lead with your phone number
- [ ] Answer the call and interact with AI
- [ ] Verify appointment created in database
- [ ] Check call logs and activity timeline
- [ ] Test in multiple languages (if applicable)

## Testing

### Unit Tests

Run basic gate and configuration tests:

```bash
pytest tests/test_ai_outbound.py -v
```

### Manual Testing (Phase A)

1. Set `AI_OUTBOUND_ENABLED=true` in `.env`
2. Enable for a dealership via PATCH `/dealerships/{id}/twilio-config`
3. Create a test lead with a valid phone
4. Check `ai_outbound_calls` table for the record
5. Check Twilio console for outbound call attempt
6. Inspect TwiML webhook logs

### Integration Testing (Phase B)

After completing Pipecat wiring:

1. Use a test phone number (e.g. your mobile)
2. Create a lead with that number
3. Answer the call
4. Interact with the AI (qualify, book appointment)
5. Verify appointment is created in DB
6. Check call logs and activity timeline

## Multilingual Support

The system detects locale from lead or dealership metadata (future enhancement).

Current locales planned:
- `en-US`: US English
- `en-IN`: Indian English
- `hi-IN`: Hindi
- `es-US`: US Spanish

System prompts and TTS voices adapt per locale.

## Compliance & Legal

**Important**: Automated calling has legal requirements in most jurisdictions.

Before enabling in production:

- [ ] Obtain explicit consent from leads (opt-in)
- [ ] Honor Do Not Call (DNC) lists
- [ ] Implement opt-out mechanism ("remove me from calls")
- [ ] Respect quiet hours (already implemented)
- [ ] Identify your dealership clearly at the start of calls
- [ ] Record calls if required by law (Twilio recording + Azure Blob)

**TCPA (US)**: Requires prior express written consent for marketing calls.  
**TRAI (India)**: Requires consent and DND compliance.

Consult legal counsel before deploying to production.

## Troubleshooting

### Calls Not Being Placed

Check in order:

1. `AI_OUTBOUND_ENABLED=true` in backend `.env`
2. Dealership has `ai_outbound_enabled=true` (GET `/dealerships/{id}/twilio-config`)
3. Lead has a valid phone number (E.164 format, e.g. `+1234567890`)
4. Not in quiet hours for dealership timezone
5. No prior `ai_outbound_calls` row for this lead
6. Twilio voice credentials configured (account SID, auth token, phone number)
7. Check backend logs for `"AI outbound"` messages

### Calls Fail After Dialing

Check:

1. Twilio webhook URLs are publicly accessible (use ngrok for local dev)
2. TwiML endpoint returns valid XML (check `/api/v1/webhooks/twilio/ai-voice/twiml` logs)
3. WebSocket URL is correct (`wss://` not `ws://` for HTTPS backends)
4. Lead token verification passes (check signature)

### WebSocket Disconnects

- Check Pipecat pipeline errors in logs
- Verify STT/LLM/TTS API keys are valid
- Check network/firewall doesn't block WebSocket connections

## Cost Estimation

At ~1,000 calls/month with 3-minute average:

- **Twilio outbound**: ~$0.015/min (US) × 3,000 min = **$45**
- **Deepgram STT**: ~$0.0043/min × 3,000 min = **$13**
- **OpenAI (GPT-4)**: ~$0.03/1K tokens × 10K tokens/call avg = **$300**
- **Cartesia TTS**: ~$0.05/1K chars × 2K chars/call = **$100**

**Total**: ~$458/month for 1,000 calls (3 min avg).

Costs scale linearly with volume and call duration. Optimize by:
- Using shorter scripts (qualify faster)
- Using GPT-3.5 for simpler flows
- Caching common phrases in TTS

## Future Enhancements

- [ ] Voicemail detection (skip to short message)
- [ ] Retry logic for no-answer (schedule follow-up)
- [ ] A/B testing different scripts
- [ ] Call recording storage (Azure Blob)
- [ ] Transcript storage in `ai_outbound_calls.meta_data`
- [ ] Dashboard for AI call analytics
- [ ] Per-dealership custom prompts
- [ ] Automatic language detection from lead name/source

## Support

For issues or questions:
1. Check logs: `grep -i "ai outbound" backend/logs/*.log`
2. Check database: `SELECT * FROM ai_outbound_calls WHERE status != 'completed';`
3. Review this README
4. Contact: [your support channel]
