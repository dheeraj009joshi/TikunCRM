"""
Call transcription — turns a recorded call into a speaker-labelled,
timestamped transcript using Deepgram's pre-recorded API.

Twilio records softphone calls in dual-channel ("record-from-answer-dual"),
so each party is on its own audio channel and speaker labels come from the
channel, not from voice diarisation guesswork.

Transcript text is never written to application logs.
"""
import logging
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.call_log import CallDirection, CallLog

logger = logging.getLogger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
PROVIDER = "deepgram"

SPEAKER_REP = "rep"
SPEAKER_CUSTOMER = "customer"

# Twilio <Dial> dual-channel recordings put the parent leg (whoever started
# the call into Twilio) on the first channel and the dialled party on the second.
#   Outbound softphone call: parent leg = rep's browser  -> ch0 rep, ch1 customer
#   Inbound call:            parent leg = the customer   -> ch0 customer, ch1 rep
# NOTE: confirm against a real recording from this account before relying on it.
_CHANNEL_SPEAKERS = {
    CallDirection.OUTBOUND: {0: SPEAKER_REP, 1: SPEAKER_CUSTOMER},
    CallDirection.INBOUND: {0: SPEAKER_CUSTOMER, 1: SPEAKER_REP},
}


class TranscriptionError(Exception):
    """Raised with a short, non-sensitive message safe to store and show."""


def parse_deepgram_response(data: Dict[str, Any], direction: CallDirection) -> List[Dict[str, Any]]:
    """
    Convert a Deepgram response into [{speaker, start, end, text}], ordered by time.

    Dual-channel audio -> speaker from the channel.
    Mono audio         -> speaker from diarisation ("speaker_0", "speaker_1"),
                          because we cannot know which voice is the rep.
    """
    results = data.get("results") or {}
    utterances = results.get("utterances") or []
    channel_count = int((data.get("metadata") or {}).get("channels") or len(results.get("channels") or []) or 1)
    channel_map = _CHANNEL_SPEAKERS.get(direction, _CHANNEL_SPEAKERS[CallDirection.OUTBOUND])

    out: List[Dict[str, Any]] = []
    for u in utterances:
        text = (u.get("transcript") or "").strip()
        if not text:
            continue
        if channel_count >= 2:
            speaker = channel_map.get(int(u.get("channel") or 0), SPEAKER_CUSTOMER)
        else:
            speaker = f"speaker_{int(u.get('speaker') or 0)}"
        out.append(
            {
                "speaker": speaker,
                "start": round(float(u.get("start") or 0.0), 2),
                "end": round(float(u.get("end") or 0.0), 2),
                "text": text,
            }
        )
    out.sort(key=lambda x: (x["start"], x["end"]))
    return out


def transcript_word_count(transcript: List[Dict[str, Any]]) -> int:
    return sum(len((u.get("text") or "").split()) for u in transcript)


async def fetch_recording_bytes(db: AsyncSession, call_log: CallLog) -> bytes:
    """Download the recording from Azure Blob (preferred) or Twilio."""
    url = call_log.recording_url
    if not url:
        raise TranscriptionError("Call has no recording")

    auth = None
    if "blob.core.windows.net" in url:
        from app.services.azure_storage_service import azure_storage_service

        if azure_storage_service.is_configured:
            blob_name = url.split("/")[-1].split("?")[0]
            secure_url = azure_storage_service.get_secure_url(blob_name, expiry_hours=1)
            if secure_url:
                url = secure_url
    elif "api.twilio.com" in url:
        from app.services.dealership_twilio_config_service import get_effective_twilio_config

        eff = await get_effective_twilio_config(db, call_log.dealership_id)
        auth = (eff.account_sid, eff.auth_token)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url, auth=auth, follow_redirects=True)
            r.raise_for_status()
            return r.content
    except httpx.HTTPStatusError as e:
        raise TranscriptionError(f"Could not download recording (HTTP {e.response.status_code})") from None
    except httpx.HTTPError as e:
        raise TranscriptionError(f"Could not download recording ({type(e).__name__})") from None


async def transcribe_audio(audio: bytes, direction: CallDirection) -> List[Dict[str, Any]]:
    """Send audio bytes to Deepgram and return the parsed transcript."""
    if not settings.deepgram_api_key:
        raise TranscriptionError("Transcription is not configured (DEEPGRAM_API_KEY is missing)")
    if not audio:
        raise TranscriptionError("Recording file is empty")

    params = {
        "model": settings.call_review_transcription_model,
        "multichannel": "true",
        "diarize": "true",
        "utterances": "true",
        "punctuate": "true",
        "smart_format": "true",
    }
    headers = {
        "Authorization": f"Token {settings.deepgram_api_key}",
        "Content-Type": "audio/wav",
    }
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            r = await client.post(DEEPGRAM_URL, params=params, headers=headers, content=audio)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        raise TranscriptionError(f"Transcription provider error (HTTP {e.response.status_code})") from None
    except httpx.HTTPError as e:
        raise TranscriptionError(f"Transcription request failed ({type(e).__name__})") from None

    return parse_deepgram_response(data, direction)


async def transcribe_call(db: AsyncSession, call_log: CallLog) -> List[Dict[str, Any]]:
    audio = await fetch_recording_bytes(db, call_log)
    transcript = await transcribe_audio(audio, call_log.direction)
    logger.info(
        "Transcribed call_log %s: %d utterances", call_log.id, len(transcript)
    )
    return transcript


def get_transcription_model() -> Optional[str]:
    return settings.call_review_transcription_model
