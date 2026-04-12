"""
SMS Service - Twilio integration for SMS notifications
"""
import logging
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.dealership_twilio_config_service import EffectiveTwilioConfig
from app.models.user import User
from app.models.lead import Lead
from app.models.dealership import Dealership

logger = logging.getLogger(__name__)


def _twilio_client(account_sid: str, auth_token: str):
    from twilio.rest import Client
    return Client(account_sid, auth_token)


class SMSService:
    """
    Service for sending SMS notifications via Twilio.
    Pass EffectiveTwilioConfig from get_effective_twilio_config(db, dealership_id).
    """

    @property
    def is_configured(self) -> bool:
        """Global SMS configured (legacy check for code paths without dealership)."""
        return settings.is_twilio_configured
    
    def format_phone_number(self, phone: str) -> Optional[str]:
        """
        Format and validate phone number to E.164 format.
        Returns None if invalid.
        """
        if not phone:
            return None
        
        try:
            import phonenumbers
            
            # Remove common prefixes
            phone = phone.strip()
            if phone.startswith("p:"):
                phone = phone[2:]
            
            # Parse the number (assume US if no country code)
            parsed = phonenumbers.parse(phone, "US")
            
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(
                    parsed, 
                    phonenumbers.PhoneNumberFormat.E164
                )
            return None
            
        except ImportError:
            # Fallback: basic formatting
            phone = ''.join(c for c in phone if c.isdigit() or c == '+')
            if phone and not phone.startswith('+'):
                phone = '+1' + phone  # Assume US
            return phone if len(phone) >= 10 else None
        except Exception as e:
            logger.warning(f"Failed to parse phone number {phone}: {e}")
            return None
    
    async def send_sms(
        self,
        to_phone: str,
        message: str,
        effective: EffectiveTwilioConfig,
        from_phone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send an SMS message.
        """
        if not effective.is_sms_ready():
            logger.warning("SMS not configured for dealership - skipping send")
            return {
                "success": False,
                "error": "SMS notifications not configured",
            }

        # Format the recipient number
        formatted_to = self.format_phone_number(to_phone)
        if not formatted_to:
            return {
                "success": False,
                "error": f"Invalid phone number: {to_phone}",
            }

        from_num = from_phone or effective.sms_from_number

        try:
            client = _twilio_client(effective.account_sid, effective.auth_token)

            sms = client.messages.create(
                body=message[:1600],
                from_=from_num,
                to=formatted_to,
            )
            
            logger.info(f"SMS sent successfully: SID={sms.sid}, to={formatted_to}")
            
            return {
                "success": True,
                "message_sid": sms.sid,
                "to": formatted_to,
                "status": sms.status
            }
            
        except Exception as e:
            logger.error(f"Failed to send SMS to {formatted_to}: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def send_bulk_sms(
        self,
        phone_numbers: List[str],
        message: str,
        effective: EffectiveTwilioConfig,
    ) -> Dict[str, Any]:
        """
        Send SMS to multiple recipients.
        """
        if not effective.is_sms_ready():
            return {
                "success": False,
                "error": "SMS notifications not configured",
                "sent": 0,
                "failed": len(phone_numbers),
            }

        sent = 0
        failed = 0
        errors = []

        for phone in phone_numbers:
            result = await self.send_sms(phone, message, effective)
            if result.get("success"):
                sent += 1
            else:
                failed += 1
                errors.append({
                    "phone": phone,
                    "error": result.get("error")
                })
        
        return {
            "success": sent > 0,
            "sent": sent,
            "failed": failed,
            "errors": errors
        }
    
    async def notify_new_lead(
        self,
        db: AsyncSession,
        lead: Lead,
        dealership_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        """
        Send SMS notifications to all team members about a new lead.
        """
        from app.services.dealership_twilio_config_service import get_effective_twilio_config

        effective = await get_effective_twilio_config(db, dealership_id or lead.dealership_id)
        if not effective.is_sms_ready():
            logger.debug("SMS not configured - skipping new lead notification")
            return {"success": False, "error": "SMS not configured", "sent": 0}
        
        # Build the message
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
        lead_phone = lead.phone or "No phone"
        
        message = (
            f"🚗 New Lead Alert!\n"
            f"Name: {lead_name}\n"
            f"Phone: {lead_phone}\n"
            f"Be the first to respond!"
        )
        
        # Get users to notify
        query = select(User).where(
            User.is_active == True,
            User.phone.isnot(None),
            User.phone != ""
        )
        
        if dealership_id:
            query = query.where(User.dealership_id == dealership_id)
        
        result = await db.execute(query)
        users = result.scalars().all()
        
        if not users:
            logger.info("No users with phone numbers to notify")
            return {"success": True, "sent": 0, "message": "No users to notify"}
        
        # Extract phone numbers
        phone_numbers = [u.phone for u in users if u.phone]
        
        return await self.send_bulk_sms(phone_numbers, message, effective)
    
    async def send_appointment_reminder(
        self,
        db: AsyncSession,
        user_id: UUID,
        appointment_title: str,
        scheduled_at: str,
        lead_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send appointment reminder SMS to a user.
        """
        from app.services.dealership_twilio_config_service import get_effective_twilio_config

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if not user or not user.phone:
            return {"success": False, "error": "User has no phone number"}

        effective = await get_effective_twilio_config(db, user.dealership_id)
        if not effective.is_sms_ready():
            return {"success": False, "error": "SMS not configured"}

        message = f"📅 Reminder: {appointment_title}\n"
        if lead_name:
            message += f"With: {lead_name}\n"
        message += f"Time: {scheduled_at}"

        return await self.send_sms(user.phone, message, effective)
    
    async def send_follow_up_reminder(
        self,
        db: AsyncSession,
        user_id: UUID,
        lead_name: str,
        due_at: str,
    ) -> Dict[str, Any]:
        """
        Send follow-up reminder SMS to a user.
        """
        from app.services.dealership_twilio_config_service import get_effective_twilio_config

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if not user or not user.phone:
            return {"success": False, "error": "User has no phone number"}

        effective = await get_effective_twilio_config(db, user.dealership_id)
        if not effective.is_sms_ready():
            return {"success": False, "error": "SMS not configured"}

        message = (
            f"⏰ Follow-up Reminder\n"
            f"Lead: {lead_name}\n"
            f"Due: {due_at}\n"
            f"Don't forget to follow up!"
        )

        return await self.send_sms(user.phone, message, effective)


# Singleton instance
sms_service = SMSService()
