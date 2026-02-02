"""
SendGrid Email Service

Professional email sending and receiving via SendGrid API.
Supports:
- Sending emails with HTML/text body
- CC/BCC recipients
- Custom Reply-To for routing replies
- Email threading via headers
- Delivery tracking via webhooks
"""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Dict, Any

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Mail, 
    Email, 
    To, 
    Cc, 
    Bcc,
    Content, 
    ReplyTo,
    Header,
    Attachment,
    FileContent,
    FileName,
    FileType,
    Disposition
)

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class SendGridEmailRequest:
    """Request object for sending email via SendGrid"""
    to_email: str
    subject: str
    body_text: str
    body_html: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    reply_to: Optional[str] = None
    reply_to_name: Optional[str] = None
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    # Threading headers
    in_reply_to: Optional[str] = None
    references: Optional[str] = None
    # Custom headers
    custom_headers: Optional[Dict[str, str]] = None
    # Attachments (list of dicts with content, filename, type)
    attachments: Optional[List[Dict[str, Any]]] = None


@dataclass
class SendGridEmailResponse:
    """Response from SendGrid API"""
    success: bool
    message_id: Optional[str] = None
    error: Optional[str] = None
    status_code: Optional[int] = None


class SendGridService:
    """
    SendGrid email service for professional email delivery.
    
    Usage:
        service = SendGridService()
        response = await service.send_email(
            SendGridEmailRequest(
                to_email="customer@example.com",
                subject="Hello",
                body_text="Plain text body",
                body_html="<h1>HTML body</h1>",
                reply_to="salesperson-123@inbound.yourcrm.com"
            )
        )
    """
    
    def __init__(self):
        self.api_key = settings.sendgrid_api_key
        self.default_from_email = settings.sendgrid_from_email or settings.email_from_address
        self.default_from_name = settings.sendgrid_from_name or settings.email_from_name
        self.inbound_domain = settings.sendgrid_inbound_domain
        
        if self.api_key:
            self.client = SendGridAPIClient(self.api_key)
        else:
            self.client = None
            logger.warning("SendGrid API key not configured")
    
    @property
    def is_configured(self) -> bool:
        """Check if SendGrid is properly configured"""
        return bool(self.api_key and self.default_from_email)
    
    def generate_message_id(self) -> str:
        """Generate a unique message ID for email threading"""
        unique_id = str(uuid.uuid4())
        domain = self.default_from_email.split('@')[1] if self.default_from_email else 'leedscrm.com'
        return f"<{unique_id}@{domain}>"
    
    def generate_inbound_address(self, user_id: str, dealership_slug: str) -> str:
        """
        Generate a unique inbound address for a user.
        This address is used in Reply-To so replies come back to this user.
        
        Format: {user_id}@{dealership_slug}.{inbound_domain}
        Example: abc123@motors.inbound.yourcrm.com
        """
        if not self.inbound_domain:
            return self.default_from_email
        
        # Shorten user_id for cleaner addresses
        short_id = str(user_id)[:8]
        return f"{short_id}@{dealership_slug}.{self.inbound_domain}"
    
    async def send_email(self, request: SendGridEmailRequest) -> SendGridEmailResponse:
        """
        Send an email via SendGrid API.
        
        Returns SendGridEmailResponse with success status and message_id.
        """
        if not self.is_configured:
            return SendGridEmailResponse(
                success=False,
                error="SendGrid is not configured. Please set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."
            )
        
        try:
            # Build the email
            from_email = Email(
                email=request.from_email or self.default_from_email,
                name=request.from_name or self.default_from_name
            )
            
            to_email = To(request.to_email)
            
            # Create mail object
            mail = Mail(
                from_email=from_email,
                to_emails=to_email,
                subject=request.subject
            )
            
            # Add content (text and/or HTML)
            if request.body_text:
                mail.add_content(Content("text/plain", request.body_text))
            if request.body_html:
                mail.add_content(Content("text/html", request.body_html))
            
            # Add Reply-To (crucial for routing replies back to correct user)
            if request.reply_to:
                mail.reply_to = ReplyTo(
                    email=request.reply_to,
                    name=request.reply_to_name
                )
            
            # Add CC recipients
            if request.cc_emails:
                for cc in request.cc_emails:
                    if cc.strip():
                        mail.add_cc(Cc(cc.strip()))
            
            # Add BCC recipients
            if request.bcc_emails:
                for bcc in request.bcc_emails:
                    if bcc.strip():
                        mail.add_bcc(Bcc(bcc.strip()))
            
            # Generate message ID for threading
            message_id = self.generate_message_id()
            mail.add_header(Header("Message-ID", message_id))
            
            # Add threading headers if replying to an email
            if request.in_reply_to:
                mail.add_header(Header("In-Reply-To", request.in_reply_to))
            if request.references:
                mail.add_header(Header("References", request.references))
            
            # Add custom headers
            if request.custom_headers:
                for key, value in request.custom_headers.items():
                    mail.add_header(Header(key, value))
            
            # Add attachments
            if request.attachments:
                for att in request.attachments:
                    attachment = Attachment(
                        FileContent(att.get('content', '')),
                        FileName(att.get('filename', 'attachment')),
                        FileType(att.get('type', 'application/octet-stream')),
                        Disposition('attachment')
                    )
                    mail.add_attachment(attachment)
            
            # Send the email
            response = self.client.send(mail)
            
            # Extract SendGrid message ID from headers
            sg_message_id = None
            if response.headers:
                sg_message_id = response.headers.get('X-Message-Id')
            
            logger.info(
                f"Email sent successfully via SendGrid: "
                f"to={request.to_email}, subject={request.subject}, "
                f"message_id={message_id}, sg_id={sg_message_id}"
            )
            
            return SendGridEmailResponse(
                success=True,
                message_id=message_id,
                status_code=response.status_code
            )
            
        except Exception as e:
            logger.error(f"SendGrid email failed: {str(e)}")
            return SendGridEmailResponse(
                success=False,
                error=str(e)
            )
    
    async def send_template_email(
        self,
        to_email: str,
        template_id: str,
        dynamic_data: Dict[str, Any],
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        reply_to: Optional[str] = None
    ) -> SendGridEmailResponse:
        """
        Send email using a SendGrid dynamic template.
        
        Useful for transactional emails with consistent formatting.
        """
        if not self.is_configured:
            return SendGridEmailResponse(
                success=False,
                error="SendGrid is not configured"
            )
        
        try:
            mail = Mail(
                from_email=Email(
                    email=from_email or self.default_from_email,
                    name=from_name or self.default_from_name
                ),
                to_emails=To(to_email)
            )
            
            mail.template_id = template_id
            mail.dynamic_template_data = dynamic_data
            
            if reply_to:
                mail.reply_to = ReplyTo(email=reply_to)
            
            response = self.client.send(mail)
            
            sg_message_id = None
            if response.headers:
                sg_message_id = response.headers.get('X-Message-Id')
            
            return SendGridEmailResponse(
                success=True,
                message_id=sg_message_id,
                status_code=response.status_code
            )
            
        except Exception as e:
            logger.error(f"SendGrid template email failed: {str(e)}")
            return SendGridEmailResponse(
                success=False,
                error=str(e)
            )


# Singleton instance
_sendgrid_service: Optional[SendGridService] = None


def get_sendgrid_service() -> SendGridService:
    """Get or create SendGrid service instance"""
    global _sendgrid_service
    if _sendgrid_service is None:
        _sendgrid_service = SendGridService()
    return _sendgrid_service
