"""
SMS Service - Twilio integration for SMS notifications
"""
import logging
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.models.lead import Lead
from app.models.dealership import Dealership

logger = logging.getLogger(__name__)


class SMSService:
    """
    Service for sending SMS notifications via Twilio.
    
    Usage:
        sms = SMSService()
        result = await sms.send_sms("+1234567890", "Hello!")
    """
    
    def __init__(self):
        self._client = None
    
    @property
    def is_configured(self) -> bool:
        """Check if SMS is properly configured"""
        return settings.is_twilio_configured
    
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
        from_phone: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send an SMS message.
        
        Args:
            to_phone: Recipient phone number
            message: Message content (max 1600 chars for concatenated SMS)
            from_phone: Sender phone number (uses default if not provided)
            
        Returns:
            Dict with success status and message SID or error
        """
        if not self.is_configured:
            logger.warning("SMS not configured - skipping send")
            return {
                "success": False,
                "error": "SMS notifications not configured"
            }
        
        # Format the recipient number
        formatted_to = self.format_phone_number(to_phone)
        if not formatted_to:
            return {
                "success": False,
                "error": f"Invalid phone number: {to_phone}"
            }
        
        from_phone = from_phone or settings.twilio_phone_number
        
        try:
            client = self._get_client()
            
            # Send the message
            sms = client.messages.create(
                body=message[:1600],  # Twilio limit
                from_=from_phone,
                to=formatted_to
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
        message: str
    ) -> Dict[str, Any]:
        """
        Send SMS to multiple recipients.
        
        Returns dict with success count and failures.
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "SMS notifications not configured",
                "sent": 0,
                "failed": len(phone_numbers)
            }
        
        sent = 0
        failed = 0
        errors = []
        
        for phone in phone_numbers:
            result = await self.send_sms(phone, message)
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
        dealership_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        Send SMS notifications to all team members about a new lead.
        
        Args:
            db: Database session
            lead: The new lead
            dealership_id: Dealership to notify (if None, notifies all with phones)
        """
        if not self.is_configured:
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
        
        # Send bulk SMS
        return await self.send_bulk_sms(phone_numbers, message)
    
    async def send_appointment_reminder(
        self,
        db: AsyncSession,
        user_id: UUID,
        appointment_title: str,
        scheduled_at: str,
        lead_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send appointment reminder SMS to a user.
        """
        if not self.is_configured:
            return {"success": False, "error": "SMS not configured"}
        
        # Get user
        result = await db.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        
        if not user or not user.phone:
            return {"success": False, "error": "User has no phone number"}
        
        # Build message
        message = f"📅 Reminder: {appointment_title}\n"
        if lead_name:
            message += f"With: {lead_name}\n"
        message += f"Time: {scheduled_at}"
        
        return await self.send_sms(user.phone, message)
    
    async def send_follow_up_reminder(
        self,
        db: AsyncSession,
        user_id: UUID,
        lead_name: str,
        due_at: str
    ) -> Dict[str, Any]:
        """
        Send follow-up reminder SMS to a user.
        """
        if not self.is_configured:
            return {"success": False, "error": "SMS not configured"}
        
        # Get user
        result = await db.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        
        if not user or not user.phone:
            return {"success": False, "error": "User has no phone number"}
        
        message = (
            f"⏰ Follow-up Reminder\n"
            f"Lead: {lead_name}\n"
            f"Due: {due_at}\n"
            f"Don't forget to follow up!"
        )
        
        return await self.send_sms(user.phone, message)


# Singleton instance
sms_service = SMSService()
