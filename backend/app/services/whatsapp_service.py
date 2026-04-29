"""
WhatsApp Service - Twilio integration for WhatsApp messaging
"""
import logging
from typing import Optional, Dict, Any

from app.core.config import settings
from app.services.dealership_twilio_config_service import (
    EffectiveTwilioConfig,
    normalize_twilio_to_number,
)

logger = logging.getLogger(__name__)


def _whatsapp_e164(raw: Optional[str]) -> str:
    """Strip optional whatsapp: URI prefix; Twilio expects bare E.164 after we add whatsapp:."""
    return normalize_twilio_to_number(raw or "").strip()


def _twilio_client(account_sid: str, auth_token: str):
    from twilio.rest import Client
    return Client(account_sid, auth_token)


class WhatsAppService:
    """
    Service for sending WhatsApp messages via Twilio.
    Pass EffectiveTwilioConfig from get_effective_twilio_config(db, dealership_id).
    """

    def format_phone_number(self, phone: str) -> Optional[str]:
        """
        Format and validate phone number to E.164 format.
        Returns None if invalid.
        """
        if not phone:
            return None

        try:
            import phonenumbers

            phone = phone.strip()
            if phone.startswith("p:"):
                phone = phone[2:]

            parsed = phonenumbers.parse(phone, "US")

            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(
                    parsed,
                    phonenumbers.PhoneNumberFormat.E164,
                )
            return None

        except ImportError:
            phone = "".join(c for c in phone if c.isdigit() or c == "+")
            if phone and not phone.startswith("+"):
                phone = "+1" + phone
            return phone if len(phone) >= 10 else None
        except Exception as e:
            logger.warning(f"Failed to parse phone number {phone}: {e}")
            return None

    async def send_whatsapp(
        self,
        to_phone: str,
        message: str,
        effective: EffectiveTwilioConfig,
        from_phone: Optional[str] = None,
        status_callback: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a WhatsApp message (session message, requires 24h window).
        """
        if not effective.is_whatsapp_ready():
            return {
                "success": False,
                "error": "WhatsApp not configured",
                "message_sid": None,
            }

        try:
            client = _twilio_client(effective.account_sid, effective.auth_token)
            from_e164 = _whatsapp_e164(from_phone or effective.whatsapp_from_number)
            to_e164 = _whatsapp_e164(to_phone)
            if not from_e164:
                print("WhatsApp From number: <not set>", flush=True)
                return {
                    "success": False,
                    "error": "WhatsApp sender number is not configured",
                    "message_sid": None,
                }

            print(f"WhatsApp From number: whatsapp:{from_e164}", flush=True)
            params = {
                "body": message,
                "from_": f"whatsapp:{from_e164}",
                "to": f"whatsapp:{to_e164}",
            }
            if status_callback:
                params["status_callback"] = status_callback

            # Run Twilio API call in thread pool to avoid blocking
            import asyncio
            msg = await asyncio.to_thread(client.messages.create, **params)

            logger.info(f"WhatsApp sent to {to_e164}: SID={msg.sid}")
            return {
                "success": True,
                "message_sid": msg.sid,
                "error": None,
            }

        except Exception as e:
            logger.error(f"Failed to send WhatsApp to {to_phone}: {e}")
            return _twilio_send_error_result(e)

    async def send_whatsapp_template(
        self,
        to_phone: str,
        content_sid: str,
        effective: EffectiveTwilioConfig,
        content_variables: Optional[Dict[str, str]] = None,
        from_phone: Optional[str] = None,
        status_callback: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a WhatsApp template message."""
        if not effective.is_whatsapp_ready():
            return {
                "success": False,
                "error": "WhatsApp not configured",
                "message_sid": None,
            }

        try:
            client = _twilio_client(effective.account_sid, effective.auth_token)
            from_e164 = _whatsapp_e164(from_phone or effective.whatsapp_from_number)
            to_e164 = _whatsapp_e164(to_phone)
            if not from_e164:
                print("WhatsApp From number: <not set>", flush=True)
                return {
                    "success": False,
                    "error": "WhatsApp sender number is not configured",
                    "message_sid": None,
                }

            print(f"WhatsApp From number: whatsapp:{from_e164}", flush=True)
            params = {
                "content_sid": content_sid,
                "from_": f"whatsapp:{from_e164}",
                "to": f"whatsapp:{to_e164}",
            }
            if content_variables:
                import json
                params["content_variables"] = json.dumps(content_variables)
            if status_callback:
                params["status_callback"] = status_callback

            # Run Twilio API call in thread pool to avoid blocking
            import asyncio
            msg = await asyncio.to_thread(client.messages.create, **params)

            logger.info(f"WhatsApp template sent to {to_e164}: SID={msg.sid}")
            return {
                "success": True,
                "message_sid": msg.sid,
                "error": None,
            }

        except Exception as e:
            logger.error(f"Failed to send WhatsApp template to {to_phone}: {e}")
            return _twilio_send_error_result(e)


def _twilio_send_error_result(exc: Exception) -> Dict[str, Any]:
    code: Optional[str] = None
    try:
        from twilio.base.exceptions import TwilioRestException

        if isinstance(exc, TwilioRestException) and exc.code is not None:
            code = str(exc.code)
    except ImportError:
        pass
    msg = str(exc)
    if code == "21212":
        msg += (
            " Check Twilio Console: the sender must be a WhatsApp-enabled number on this "
            "same Twilio account. If you use a copied database, fix SECRET_KEY and re-save "
            "Twilio credentials in Settings, or set TWILIO_* in .env so account and sender match."
        )
    return {"success": False, "message_sid": None, "error": msg, "error_code": code}


whatsapp_service = WhatsAppService()
