"""
Resolve per-dealership Twilio settings with global settings fallback.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.models.dealership_twilio_config import DealershipTwilioConfig

logger = logging.getLogger(__name__)


def digits_last10(phone: Optional[str]) -> str:
    """Normalize to last 10 digits for comparing Twilio From/To numbers."""
    if not phone:
        return ""
    cleaned = phone.replace("whatsapp:", "").strip()
    digits = "".join(c for c in cleaned if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def normalize_twilio_to_number(raw: str) -> str:
    """Strip whatsapp: prefix for display/storage consistency."""
    s = raw.strip()
    if s.lower().startswith("whatsapp:"):
        return s[9:].strip()
    return s


@dataclass(frozen=True)
class EffectiveTwilioConfig:
    """Merged dealership row + global settings."""

    dealership_id: Optional[UUID]
    account_sid: str
    auth_token: str
    sms_enabled: bool
    sms_from_number: str
    whatsapp_enabled: bool
    whatsapp_from_number: str
    voice_enabled: bool
    twilio_twiml_app_sid: str
    twilio_api_key_sid: str
    twilio_api_key_secret: str
    voice_caller_id_number: str

    def is_sms_ready(self) -> bool:
        return bool(
            self.sms_enabled
            and self.account_sid
            and self.auth_token
            and self.sms_from_number
        )

    def is_whatsapp_ready(self) -> bool:
        return bool(
            self.whatsapp_enabled
            and self.account_sid
            and self.auth_token
            and self.whatsapp_from_number
        )

    def is_voice_ready(self) -> bool:
        return bool(
            self.voice_enabled
            and self.account_sid
            and self.auth_token
            and self.twilio_twiml_app_sid
            and self.twilio_api_key_sid
            and self.twilio_api_key_secret
            and self.voice_caller_id_number
        )


def _merge(row: Optional[DealershipTwilioConfig], s: Settings) -> EffectiveTwilioConfig:
    account_sid = (row.account_sid if row else None) or s.twilio_account_sid or ""
    auth_token = ""
    if row:
        auth_token = row.auth_token or ""
    if not auth_token:
        auth_token = s.twilio_auth_token or ""

    sms_from = (row.sms_from_number if row else None) or s.twilio_phone_number or ""
    wa_from = (row.whatsapp_from_number if row else None) or s.twilio_whatsapp_number or ""
    voice_caller = (row.voice_caller_id_number if row else None) or s.twilio_phone_number or ""

    sms_enabled_flag = (
        row.sms_enabled if row is not None else s.sms_notifications_enabled
    )
    wa_enabled_flag = row.whatsapp_enabled if row is not None else s.whatsapp_enabled
    voice_enabled_flag = row.voice_enabled if row is not None else s.voice_enabled

    twiml = (row.twilio_twiml_app_sid if row else None) or s.twilio_twiml_app_sid or ""
    api_sid = (row.twilio_api_key_sid if row else None) or s.twilio_api_key_sid or ""
    api_secret = ""
    if row:
        api_secret = row.twilio_api_key_secret or ""
    if not api_secret:
        api_secret = s.twilio_api_key_secret or ""

    sms_enabled = bool(sms_enabled_flag and account_sid and auth_token and sms_from)
    whatsapp_enabled = bool(wa_enabled_flag and account_sid and auth_token and wa_from)
    voice_ok = bool(
        voice_enabled_flag
        and account_sid
        and auth_token
        and twiml
        and api_sid
        and api_secret
        and voice_caller
    )

    return EffectiveTwilioConfig(
        dealership_id=row.dealership_id if row else None,
        account_sid=account_sid,
        auth_token=auth_token,
        sms_enabled=sms_enabled,
        sms_from_number=sms_from,
        whatsapp_enabled=whatsapp_enabled,
        whatsapp_from_number=wa_from,
        voice_enabled=voice_ok,
        twilio_twiml_app_sid=twiml,
        twilio_api_key_sid=api_sid,
        twilio_api_key_secret=api_secret,
        voice_caller_id_number=voice_caller,
    )


async def get_dealership_twilio_row(
    db: AsyncSession, dealership_id: UUID
) -> Optional[DealershipTwilioConfig]:
    result = await db.execute(
        select(DealershipTwilioConfig).where(
            DealershipTwilioConfig.dealership_id == dealership_id
        )
    )
    return result.scalar_one_or_none()


async def get_effective_twilio_config(
    db: AsyncSession, dealership_id: Optional[UUID]
) -> EffectiveTwilioConfig:
    """
    Load dealership Twilio row when dealership_id is set; merge with global settings.
    When dealership_id is None, use global settings only (same as no row).
    """
    row: Optional[DealershipTwilioConfig] = None
    if dealership_id:
        row = await get_dealership_twilio_row(db, dealership_id)
    return _merge(row, settings)


async def find_dealership_id_by_inbound_to(
    db: AsyncSession, to_raw: str
) -> Optional[UUID]:
    """
    Match Twilio inbound SMS/WhatsApp To address to a dealership's configured numbers.
    """
    to_key = digits_last10(normalize_twilio_to_number(to_raw))
    if len(to_key) < 10:
        return None

    result = await db.execute(select(DealershipTwilioConfig))
    for cfg in result.scalars().all():
        for num in (cfg.sms_from_number, cfg.whatsapp_from_number):
            if num and digits_last10(num) == to_key:
                return cfg.dealership_id
    return None


async def find_dealership_id_by_voice_to(
    db: AsyncSession, to_raw: str
) -> Optional[UUID]:
    """Match inbound voice To (called number) to voice_caller_id_number."""
    to_key = digits_last10(to_raw or "")
    if len(to_key) < 10:
        return None

    result = await db.execute(select(DealershipTwilioConfig))
    for cfg in result.scalars().all():
        if cfg.voice_caller_id_number and digits_last10(cfg.voice_caller_id_number) == to_key:
            return cfg.dealership_id
    return None
