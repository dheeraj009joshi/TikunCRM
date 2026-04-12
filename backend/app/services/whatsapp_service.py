"""
WhatsApp Service - Twilio integration for WhatsApp messaging
"""
import logging
from typing import Optional, Dict, Any

from app.core.config import settings
from app.services.dealership_twilio_config_service import EffectiveTwilioConfig

logger = logging.getLogger(__name__)


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
            from_number = from_phone or effective.whatsapp_from_number

            params = {
                "body": message,
                "from_": f"whatsapp:{from_number}",
                "to": f"whatsapp:{to_phone}",
            }
            if status_callback:
                params["status_callback"] = status_callback

            msg = client.messages.create(**params)

            logger.info(f"WhatsApp sent to {to_phone}: SID={msg.sid}")
            return {
                "success": True,
                "message_sid": msg.sid,
                "error": None,
            }

        except Exception as e:
            logger.error(f"Failed to send WhatsApp to {to_phone}: {e}")
            return {
                "success": False,
                "message_sid": None,
                "error": str(e),
            }

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
            from_number = from_phone or effective.whatsapp_from_number

            params = {
                "content_sid": content_sid,
                "from_": f"whatsapp:{from_number}",
                "to": f"whatsapp:{to_phone}",
            }
            if content_variables:
                import json
                params["content_variables"] = json.dumps(content_variables)
            if status_callback:
                params["status_callback"] = status_callback

            msg = client.messages.create(**params)

            logger.info(f"WhatsApp template sent to {to_phone}: SID={msg.sid}")
            return {
                "success": True,
                "message_sid": msg.sid,
                "error": None,
            }

        except Exception as e:
            logger.error(f"Failed to send WhatsApp template to {to_phone}: {e}")
            return {
                "success": False,
                "message_sid": None,
                "error": str(e),
            }


whatsapp_service = WhatsAppService()
