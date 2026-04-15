"""
Schemas for Super Admin per-dealership Twilio configuration.
"""
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class DealershipTwilioConfigResponse(BaseModel):
    dealership_id: UUID
    account_sid: Optional[str] = None
    auth_token_set: bool = False
    # Decrypted values; only included when caller sent X-Config-Unlock-Token (same as GET/PATCH auth)
    auth_token: Optional[str] = None
    sms_enabled: bool = False
    sms_from_number: Optional[str] = None
    whatsapp_enabled: bool = False
    whatsapp_from_number: Optional[str] = None
    voice_enabled: bool = False
    twilio_twiml_app_sid: Optional[str] = None
    twilio_api_key_sid: Optional[str] = None
    api_key_secret_set: bool = False
    twilio_api_key_secret: Optional[str] = None
    voice_caller_id_number: Optional[str] = None


class DealershipTwilioConfigUpdate(BaseModel):
    account_sid: Optional[str] = None
    auth_token: Optional[str] = Field(None, description="Set only to change; omit or empty to keep")
    sms_enabled: Optional[bool] = None
    sms_from_number: Optional[str] = None
    whatsapp_enabled: Optional[bool] = None
    whatsapp_from_number: Optional[str] = None
    voice_enabled: Optional[bool] = None
    twilio_twiml_app_sid: Optional[str] = None
    twilio_api_key_sid: Optional[str] = None
    twilio_api_key_secret: Optional[str] = Field(
        None, description="Set only to change API key secret"
    )
    voice_caller_id_number: Optional[str] = None
