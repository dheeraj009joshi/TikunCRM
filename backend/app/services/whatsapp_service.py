"""
WhatsApp Service - Twilio integration for WhatsApp messaging
"""
import logging
from typing import Optional, Dict, Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class WhatsAppService:
    """
    Service for sending WhatsApp messages via Twilio.
    
    Usage:
        wa = WhatsAppService()
        result = await wa.send_whatsapp("+1234567890", "Hello!")
    """
    
    def __init__(self):
        self._client = None
    
    @property
    def is_configured(self) -> bool:
        """Check if WhatsApp is properly configured"""
        return settings.is_whatsapp_configured
    
    def _get_client(self):
        """Get or create Twilio client"""
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
                    phonenumbers.PhoneNumberFormat.E164
                )
            return None
            
        except ImportError:
            phone = ''.join(c for c in phone if c.isdigit() or c == '+')
            if phone and not phone.startswith('+'):
                phone = '+1' + phone
            return phone if len(phone) >= 10 else None
        except Exception as e:
            logger.warning(f"Failed to parse phone number {phone}: {e}")
            return None
    
    async def send_whatsapp(
        self,
        to_phone: str,
        message: str,
        from_phone: Optional[str] = None,
        status_callback: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a WhatsApp message (session message, requires 24h window).
        
        Args:
            to_phone: Recipient phone number (E.164)
            message: Message content
            from_phone: Sender WhatsApp number (uses default if not provided)
            status_callback: Webhook URL for delivery status updates
            
        Returns:
            dict with success, message_sid, error keys
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "WhatsApp not configured",
                "message_sid": None
            }
        
        try:
            client = self._get_client()
            from_number = from_phone or settings.twilio_whatsapp_number
            
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
                "error": None
            }
            
        except Exception as e:
            logger.error(f"Failed to send WhatsApp to {to_phone}: {e}")
            return {
                "success": False,
                "message_sid": None,
                "error": str(e)
            }
    
    async def send_whatsapp_template(
        self,
        to_phone: str,
        content_sid: str,
        content_variables: Optional[Dict[str, str]] = None,
        from_phone: Optional[str] = None,
        status_callback: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a WhatsApp template message (can be sent anytime, no 24h window required).
        
        Args:
            to_phone: Recipient phone number (E.164)
            content_sid: Twilio Content SID (HX...)
            content_variables: Template variable substitutions
            from_phone: Sender WhatsApp number
            status_callback: Webhook URL for delivery status updates
            
        Returns:
            dict with success, message_sid, error keys
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "WhatsApp not configured",
                "message_sid": None
            }
        
        try:
            client = self._get_client()
            from_number = from_phone or settings.twilio_whatsapp_number
            
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
                "error": None
            }
            
        except Exception as e:
            logger.error(f"Failed to send WhatsApp template to {to_phone}: {e}")
            return {
                "success": False,
                "message_sid": None,
                "error": str(e)
            }


# Global instance for import
whatsapp_service = WhatsAppService()
