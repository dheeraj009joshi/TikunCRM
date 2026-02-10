"""
WhatsApp Service - Twilio WhatsApp integration
Uses same Twilio account; from/to use whatsapp:+E164 format.
"""
import json
import logging
from typing import Optional, Dict, Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class WhatsAppService:
    """Send WhatsApp messages via Twilio Messages API (whatsapp:+number)."""

    def __init__(self):
        self._client = None

    @property
    def is_configured(self) -> bool:
        return settings.is_whatsapp_configured

    def _get_client(self):
        if self._client is None:
            try:
                from twilio.rest import Client
                self._client = Client(
                    settings.twilio_account_sid,
                    settings.twilio_auth_token
                )
            except ImportError:
                logger.error("Twilio package not installed. Run: pip install twilio")
                raise
        return self._client

    def format_phone_number(self, phone: str) -> Optional[str]:
        """E.164 format for WhatsApp (same as SMS)."""
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
                    phonenumbers.PhoneNumberFormat.E164
                )
            return None
        except ImportError:
            phone = "".join(c for c in phone if c.isdigit() or c == "+")
            if phone and not phone.startswith("+"):
                phone = "+1" + phone
            return phone if len(phone) >= 10 else None
        except Exception as e:
            logger.warning(f"Failed to parse phone {phone}: {e}")
            return None

    async def send_whatsapp(
        self,
        to_phone: str,
        message: str,
        status_callback: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send WhatsApp message via Twilio.
        from_='whatsapp:+14155238886', to='whatsapp:+15551234567'
        If status_callback URL is provided, Twilio will POST delivery status updates there.
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "WhatsApp is not configured"
            }
        formatted_to = self.format_phone_number(to_phone)
        if not formatted_to:
            return {
                "success": False,
                "error": f"Invalid phone number: {to_phone}"
            }
        from_num = settings.twilio_whatsapp_number
        if not from_num.startswith("whatsapp:"):
            from_num = f"whatsapp:{from_num}" if from_num.startswith("+") else f"whatsapp:+{from_num}"
        to_num = formatted_to if formatted_to.startswith("whatsapp:") else f"whatsapp:{formatted_to}"
        try:
            client = self._get_client()
            create_kw: Dict[str, Any] = {
                "body": message[:4096],
                "from_": from_num,
                "to": to_num,
            }
            if status_callback:
                create_kw["status_callback"] = status_callback
            msg = client.messages.create(**create_kw)
            logger.info(f"WhatsApp sent: SID={msg.sid}, to={to_num}")
            return {
                "success": True,
                "message_sid": msg.sid,
                "to": formatted_to,
                "status": msg.status
            }
        except Exception as e:
            error_code: Optional[str] = None
            try:
                from twilio.base.exceptions import TwilioRestException
                if isinstance(e, TwilioRestException):
                    error_code = str(e.code) if e.code is not None else None
            except ImportError:
                pass
            logger.error(f"Failed to send WhatsApp to {formatted_to}: {e}")
            return {
                "success": False,
                "error": str(e),
                "error_code": error_code,
            }

    async def send_whatsapp_template(
        self,
        to_phone: str,
        content_sid: str,
        content_variables: Dict[str, str],
        status_callback: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send WhatsApp template message via Twilio (Content SID + variables).
        Use for messages outside the 24-hour session window.
        Do not pass body; Twilio uses the approved template.
        content_variables: e.g. {"1": "value1", "2": "value2"} for {{1}}, {{2}}.
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "WhatsApp is not configured",
            }
        formatted_to = self.format_phone_number(to_phone)
        if not formatted_to:
            return {
                "success": False,
                "error": f"Invalid phone number: {to_phone}",
            }
        from_num = settings.twilio_whatsapp_number
        if not from_num.startswith("whatsapp:"):
            from_num = f"whatsapp:{from_num}" if from_num.startswith("+") else f"whatsapp:+{from_num}"
        to_num = formatted_to if formatted_to.startswith("whatsapp:") else f"whatsapp:{formatted_to}"
        try:
            client = self._get_client()
            create_kw: Dict[str, Any] = {
                "from_": from_num,
                "to": to_num,
                "content_sid": content_sid,
                "content_variables": json.dumps(content_variables) if content_variables else "{}",
            }
            if status_callback:
                create_kw["status_callback"] = status_callback
            msg = client.messages.create(**create_kw)
            logger.info(f"WhatsApp template sent: SID={msg.sid}, to={to_num}, content_sid={content_sid}")
            return {
                "success": True,
                "message_sid": msg.sid,
                "to": formatted_to,
                "status": msg.status,
            }
        except Exception as e:
            error_code = None
            try:
                from twilio.base.exceptions import TwilioRestException
                if isinstance(e, TwilioRestException):
                    error_code = str(e.code) if e.code is not None else None
            except ImportError:
                pass
            logger.error(f"Failed to send WhatsApp template to {formatted_to}: {e}")
            return {
                "success": False,
                "error": str(e),
                "error_code": error_code,
            }


whatsapp_service = WhatsAppService()
