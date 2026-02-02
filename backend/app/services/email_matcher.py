"""
Email Matcher Service
Matches incoming emails to leads and users in the CRM
"""
import logging
from dataclasses import dataclass
from typing import Optional, Tuple
from uuid import UUID

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead import Lead
from app.models.user import User
from app.models.email_log import EmailLog, EmailDirection
from app.services.imap_service import IncomingEmail

logger = logging.getLogger(__name__)


@dataclass
class EmailMatch:
    """Result of email matching"""
    lead_id: Optional[UUID] = None
    lead_name: Optional[str] = None
    user_id: Optional[UUID] = None
    user_name: Optional[str] = None
    dealership_id: Optional[UUID] = None
    is_new_lead: bool = False


class EmailMatcherService:
    """
    Service for matching incoming emails to leads and users.
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def match_email(
        self,
        incoming_email: IncomingEmail,
        dealership_id: UUID
    ) -> EmailMatch:
        """
        Match an incoming email to a lead and user (salesperson).
        
        Priority for matching:
        1. Threading - If this is a reply, find the original sent email and use its lead/user
        2. Lead email - Match sender email to a lead in the dealership
        3. User email - Match recipient to a dealership user
        
        Args:
            incoming_email: The incoming email to match
            dealership_id: The dealership the email is for
            
        Returns:
            EmailMatch with matched lead and user info
        """
        match = EmailMatch(dealership_id=dealership_id)
        
        # PRIORITY 1: Try to match via threading headers (In-Reply-To, References)
        # This is the most reliable way to route replies to the correct salesperson
        thread_lead, thread_user = await self.find_thread_context(
            incoming_email.in_reply_to,
            incoming_email.references
        )
        
        if thread_lead:
            match.lead_id = thread_lead.id
            match.lead_name = f"{thread_lead.first_name} {thread_lead.last_name}"
            logger.info(f"Matched email to lead via threading: {match.lead_name}")
        
        if thread_user:
            match.user_id = thread_user.id
            match.user_name = f"{thread_user.first_name} {thread_user.last_name}"
            logger.info(f"Matched email to salesperson via threading: {match.user_name}")
        
        # PRIORITY 2: If no lead found via threading, try matching sender email to lead
        if not match.lead_id:
            lead = await self._find_lead_by_email(incoming_email.from_email, dealership_id)
            if lead:
                match.lead_id = lead.id
                match.lead_name = f"{lead.first_name} {lead.last_name}"
                logger.info(f"Matched email to lead via sender email: {match.lead_name}")
                
                # If we found a lead but no user from threading, use the assigned salesperson
                if not match.user_id and lead.assigned_to:
                    user_result = await self.db.execute(
                        select(User).where(User.id == lead.assigned_to)
                    )
                    assigned_user = user_result.scalar_one_or_none()
                    if assigned_user:
                        match.user_id = assigned_user.id
                        match.user_name = f"{assigned_user.first_name} {assigned_user.last_name}"
                        logger.info(f"Matched email to assigned salesperson: {match.user_name}")
        
        # PRIORITY 3: If still no user, try matching by recipient email
        if not match.user_id:
            user = await self._find_user_by_dealership_email(
                incoming_email.to_email,
                dealership_id
            )
            if user:
                match.user_id = user.id
                match.user_name = f"{user.first_name} {user.last_name}"
                logger.info(f"Matched email to user via recipient email: {match.user_name}")
        
        return match
    
    async def _find_lead_by_email(
        self,
        email_address: str,
        dealership_id: UUID
    ) -> Optional[Lead]:
        """
        Find a lead by their email address within a dealership.
        
        Args:
            email_address: Email to search for
            dealership_id: Dealership to search within
            
        Returns:
            Lead if found, None otherwise
        """
        # Search in the dealership's leads
        query = select(Lead).where(
            Lead.dealership_id == dealership_id,
            Lead.email == email_address.lower()
        )
        result = await self.db.execute(query)
        lead = result.scalar_one_or_none()
        
        if lead:
            return lead
        
        # Also try to find leads without dealership (unassigned)
        query = select(Lead).where(
            Lead.email == email_address.lower()
        )
        result = await self.db.execute(query)
        return result.scalars().first()
    
    async def _find_user_by_dealership_email(
        self,
        email_address: str,
        dealership_id: UUID
    ) -> Optional[User]:
        """
        Find a user by their dealership email address.
        
        Args:
            email_address: Dealership email to search for
            dealership_id: Dealership to search within
            
        Returns:
            User if found, None otherwise
        """
        # Search by dealership_email field
        query = select(User).where(
            User.dealership_id == dealership_id,
            User.dealership_email == email_address.lower()
        )
        result = await self.db.execute(query)
        user = result.scalar_one_or_none()
        
        if user:
            return user
        
        # Fallback: try matching by regular email (for users who haven't set dealership_email)
        query = select(User).where(
            User.dealership_id == dealership_id,
            User.email == email_address.lower()
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()
    
    async def create_email_log(
        self,
        incoming_email: IncomingEmail,
        match: EmailMatch
    ) -> EmailLog:
        """
        Create an email log entry for an incoming email.
        
        Args:
            incoming_email: The incoming email
            match: Matching result with lead/user info
            
        Returns:
            Created EmailLog entry
        """
        email_log = EmailLog(
            lead_id=match.lead_id,
            user_id=match.user_id,
            direction=EmailDirection.RECEIVED,
            from_email=incoming_email.from_email,
            to_email=incoming_email.to_email,
            subject=incoming_email.subject,
            body_text=incoming_email.body_text,
            body_html=incoming_email.body_html,
            message_id=incoming_email.message_id,
            in_reply_to=incoming_email.in_reply_to,
            references=incoming_email.references,
            sent_at=incoming_email.date,
        )
        
        self.db.add(email_log)
        await self.db.flush()
        
        return email_log
    
    async def check_email_exists(self, message_id: str) -> bool:
        """
        Check if an email with the given message ID already exists.
        Used to avoid duplicate imports.
        
        Args:
            message_id: Email Message-ID header
            
        Returns:
            True if email already exists
        """
        if not message_id:
            return False
        
        query = select(EmailLog.id).where(EmailLog.message_id == message_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none() is not None
    
    async def find_thread_context(
        self,
        in_reply_to: Optional[str],
        references: Optional[str]
    ) -> Tuple[Optional[Lead], Optional[User]]:
        """
        Find the lead AND the salesperson from email threading headers.
        This is crucial for routing replies to the correct salesperson.
        
        Args:
            in_reply_to: In-Reply-To header
            references: References header
            
        Returns:
            Tuple of (Lead, User) found through threading
        """
        message_ids = []
        
        if in_reply_to:
            message_ids.append(in_reply_to.strip())
        
        if references:
            # References header can contain multiple message IDs
            message_ids.extend(references.strip().split())
        
        if not message_ids:
            return None, None
        
        # Find any email log with matching message ID that has user_id (the salesperson who sent it)
        query = (
            select(EmailLog)
            .where(
                EmailLog.message_id.in_(message_ids),
                EmailLog.direction == EmailDirection.SENT  # We want the SENT email to find who sent it
            )
            .order_by(EmailLog.sent_at.desc())
        )
        result = await self.db.execute(query)
        email_log = result.scalars().first()
        
        lead = None
        user = None
        
        if email_log:
            # Get the lead from the thread
            if email_log.lead_id:
                lead_result = await self.db.execute(
                    select(Lead).where(Lead.id == email_log.lead_id)
                )
                lead = lead_result.scalar_one_or_none()
            
            # Get the salesperson who sent the original email
            if email_log.user_id:
                user_result = await self.db.execute(
                    select(User).where(User.id == email_log.user_id)
                )
                user = user_result.scalar_one_or_none()
        
        return lead, user
    
    async def find_thread_lead(
        self,
        in_reply_to: Optional[str],
        references: Optional[str]
    ) -> Optional[Lead]:
        """
        Find a lead by looking at email threading headers.
        Useful when the sender email doesn't match a lead directly.
        
        Args:
            in_reply_to: In-Reply-To header
            references: References header
            
        Returns:
            Lead if found through threading
        """
        lead, _ = await self.find_thread_context(in_reply_to, references)
        return lead
