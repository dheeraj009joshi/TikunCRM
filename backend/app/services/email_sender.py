"""
Email Sending Service
Each user configures their own Hostinger/SMTP credentials
"""
import smtplib
import ssl
import re
import uuid as uuid_module
import logging
from abc import ABC, abstractmethod
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr, make_msgid
from datetime import datetime
from typing import Dict, List, Optional, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now

from app.core.config import settings
from app.core.encryption import decrypt_value
from app.models.email_log import EmailLog, EmailDirection, EmailDeliveryStatus
from app.models.email_template import EmailTemplate
from app.models.lead import Lead
from app.models.user import User
from app.models.dealership import Dealership
from app.models.dealership_email_config import DealershipEmailConfig
from app.models.activity import ActivityType
from app.services.activity import ActivityService

logger = logging.getLogger(__name__)


# ============== Email Provider Abstraction ==============

class EmailProvider(ABC):
    """Abstract base class for email providers"""
    
    @abstractmethod
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Send an email and return result"""
        pass
    
    @abstractmethod
    def is_configured(self) -> bool:
        """Check if provider is properly configured"""
        pass


class SMTPProvider(EmailProvider):
    """SMTP email provider using system settings (fallback)"""
    
    def is_configured(self) -> bool:
        return bool(settings.smtp_user and settings.smtp_password)
    
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            return {"success": False, "error": "SMTP not configured"}
        
        try:
            message_id = make_msgid()
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = formataddr((from_name, from_email))
            msg['To'] = to_email
            msg['Message-ID'] = message_id
            
            if reply_to:
                msg['Reply-To'] = reply_to
            if cc_emails:
                msg['Cc'] = ', '.join(cc_emails)
            
            if body_text:
                msg.attach(MIMEText(body_text, 'plain'))
            if body_html:
                msg.attach(MIMEText(body_html, 'html'))
            
            recipients = [to_email]
            if cc_emails:
                recipients.extend(cc_emails)
            if bcc_emails:
                recipients.extend(bcc_emails)
            
            # Use SSL (port 465) or TLS (port 587)
            use_ssl = getattr(settings, 'smtp_use_ssl', False)
            
            if use_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context) as server:
                    server.login(settings.smtp_user, settings.smtp_password)
                    server.sendmail(settings.smtp_user, recipients, msg.as_string())
            else:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                    if settings.smtp_use_tls:
                        server.starttls()
                    server.login(settings.smtp_user, settings.smtp_password)
                    server.sendmail(settings.smtp_user, recipients, msg.as_string())
            
            return {"success": True, "message_id": message_id}
        except Exception as e:
            return {"success": False, "error": str(e)}


class UserSMTPProvider(EmailProvider):
    """SMTP provider using user's own Hostinger credentials"""
    
    def __init__(self, user: User):
        self.user = user
        self._password = None
    
    def is_configured(self) -> bool:
        return bool(
            self.user and 
            self.user.smtp_email and 
            self.user.smtp_host and 
            self.user.smtp_password_encrypted
        )
    
    def _get_password(self) -> Optional[str]:
        """Decrypt and return password"""
        if self._password is None and self.user.smtp_password_encrypted:
            try:
                self._password = decrypt_value(self.user.smtp_password_encrypted)
            except Exception as e:
                logger.error(f"Failed to decrypt SMTP password for user {self.user.id}: {e}")
                return None
        return self._password
    
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "success": False, 
                "error": "Email not configured. Please set up your email credentials in Settings > Email Configuration.",
                "config_error": True
            }
        
        password = self._get_password()
        if not password:
            return {
                "success": False, 
                "error": "Failed to decrypt email password. Please re-save your email configuration.",
                "config_error": True
            }
        
        try:
            message_id = make_msgid()
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = formataddr((from_name, from_email))
            msg['To'] = to_email
            msg['Message-ID'] = message_id
            
            if reply_to:
                msg['Reply-To'] = reply_to
            if cc_emails:
                msg['Cc'] = ', '.join(cc_emails)
            
            if body_text:
                msg.attach(MIMEText(body_text, 'plain'))
            if body_html:
                msg.attach(MIMEText(body_html, 'html'))
            
            recipients = [to_email]
            if cc_emails:
                recipients.extend(cc_emails)
            if bcc_emails:
                recipients.extend(bcc_emails)
            
            # Connect using user's SMTP settings
            if self.user.smtp_use_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(self.user.smtp_host, self.user.smtp_port, context=context, timeout=30) as server:
                    server.login(self.user.smtp_email, password)
                    server.sendmail(self.user.smtp_email, recipients, msg.as_string())
            else:
                with smtplib.SMTP(self.user.smtp_host, self.user.smtp_port, timeout=30) as server:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.login(self.user.smtp_email, password)
                    server.sendmail(self.user.smtp_email, recipients, msg.as_string())
            
            logger.info(f"Email sent successfully via user SMTP: user={self.user.email}, to={to_email}")
            return {"success": True, "message_id": message_id}
            
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP auth failed for user {self.user.email}: {e}")
            return {
                "success": False, 
                "error": "Authentication failed. Please check your email and password in Settings > Email Configuration.",
                "config_error": True
            }
        except smtplib.SMTPConnectError as e:
            logger.error(f"SMTP connect failed for user {self.user.email}: {e}")
            return {
                "success": False, 
                "error": f"Could not connect to {self.user.smtp_host}:{self.user.smtp_port}. Check your settings.",
                "config_error": True
            }
        except smtplib.SMTPException as e:
            logger.error(f"SMTP error for user {self.user.email}: {e}")
            return {"success": False, "error": f"SMTP Error: {str(e)}"}
        except Exception as e:
            logger.error(f"Email send failed for user {self.user.email}: {e}")
            return {"success": False, "error": str(e)}


class DealershipSMTPProvider(EmailProvider):
    """SMTP provider using dealership-specific configuration (legacy/fallback)"""
    
    def __init__(self, config: DealershipEmailConfig):
        self.config = config
    
    def is_configured(self) -> bool:
        return bool(self.config and self.config.smtp_host and self.config.smtp_username)
    
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            return {"success": False, "error": "Dealership SMTP not configured"}
        
        try:
            message_id = make_msgid()
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = formataddr((from_name, from_email))
            msg['To'] = to_email
            msg['Message-ID'] = message_id
            
            if reply_to:
                msg['Reply-To'] = reply_to
            if cc_emails:
                msg['Cc'] = ', '.join(cc_emails)
            
            if body_text:
                msg.attach(MIMEText(body_text, 'plain'))
            if body_html:
                msg.attach(MIMEText(body_html, 'html'))
            
            recipients = [to_email]
            if cc_emails:
                recipients.extend(cc_emails)
            if bcc_emails:
                recipients.extend(bcc_emails)
            
            # Get decrypted password
            password = self.config.smtp_password
            
            # Use SSL or TLS based on config
            if self.config.smtp_use_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(self.config.smtp_host, self.config.smtp_port, context=context) as server:
                    server.login(self.config.smtp_username, password)
                    server.sendmail(from_email, recipients, msg.as_string())
            else:
                with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port) as server:
                    if self.config.smtp_use_tls:
                        context = ssl.create_default_context()
                        server.starttls(context=context)
                    server.login(self.config.smtp_username, password)
                    server.sendmail(from_email, recipients, msg.as_string())
            
            return {"success": True, "message_id": message_id}
        except smtplib.SMTPAuthenticationError as e:
            return {"success": False, "error": f"Authentication failed: {str(e)}"}
        except smtplib.SMTPConnectError as e:
            return {"success": False, "error": f"Connection failed: {str(e)}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


class SendGridProvider(EmailProvider):
    """SendGrid email provider (Recommended for production)"""
    
    def __init__(self):
        self.message_id = None
        self.sendgrid_message_id = None
    
    def is_configured(self) -> bool:
        return settings.is_sendgrid_configured
    
    def generate_message_id(self) -> str:
        """Generate a unique message ID for threading"""
        unique_id = str(uuid_module.uuid4())
        from_email = settings.sendgrid_from_email or "leedscrm.com"
        domain = from_email.split('@')[1] if '@' in from_email else from_email
        return f"<{unique_id}@{domain}>"
    
    def generate_inbound_address(self, user_id: str, dealership_slug: str) -> str:
        """
        Generate inbound address for reply routing.
        Format: {user_id_prefix}@{dealership_slug}.{inbound_domain}
        """
        if not settings.sendgrid_inbound_domain:
            return None
        
        short_id = str(user_id)[:8]
        slug = dealership_slug.lower().replace(' ', '-').replace('_', '-')
        return f"{short_id}@{slug}.{settings.sendgrid_inbound_domain}"
    
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        in_reply_to: Optional[str] = None,
        references: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            return {"success": False, "error": "SendGrid not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL."}
        
        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import (
                Mail, Email, To, Cc, Bcc, Content, ReplyTo, Header
            )
            
            # Generate message ID for threading
            self.message_id = self.generate_message_id()
            
            # Build email
            mail = Mail(
                from_email=Email(from_email, from_name),
                to_emails=To(to_email),
                subject=subject
            )
            
            # Add content
            if body_text:
                mail.add_content(Content("text/plain", body_text))
            if body_html:
                mail.add_content(Content("text/html", body_html))
            
            # Add Reply-To (crucial for routing)
            if reply_to:
                mail.reply_to = ReplyTo(reply_to)
            
            # Add CC/BCC
            if cc_emails:
                for cc in cc_emails:
                    if cc.strip():
                        mail.add_cc(Cc(cc.strip()))
            if bcc_emails:
                for bcc in bcc_emails:
                    if bcc.strip():
                        mail.add_bcc(Bcc(bcc.strip()))
            
            # Add threading headers
            mail.add_header(Header("Message-ID", self.message_id))
            if in_reply_to:
                mail.add_header(Header("In-Reply-To", in_reply_to))
            if references:
                mail.add_header(Header("References", references))
            
            # Enable open/click tracking
            mail.tracking_settings = {
                "click_tracking": {"enable": True},
                "open_tracking": {"enable": True}
            }
            
            # Send via SendGrid
            client = SendGridAPIClient(settings.sendgrid_api_key)
            response = client.send(mail)
            
            # Get SendGrid message ID
            self.sendgrid_message_id = None
            if response.headers:
                self.sendgrid_message_id = response.headers.get("X-Message-Id")
            
            logger.info(f"Email sent via SendGrid: to={to_email}, sg_id={self.sendgrid_message_id}")
            
            return {
                "success": True,
                "message_id": self.message_id,
                "sendgrid_message_id": self.sendgrid_message_id
            }
            
        except ImportError:
            return {"success": False, "error": "sendgrid not installed. Run: pip install sendgrid"}
        except Exception as e:
            logger.error(f"SendGrid send failed: {e}")
            return {"success": False, "error": str(e)}


class MailgunProvider(EmailProvider):
    """Mailgun email provider"""
    
    def is_configured(self) -> bool:
        return bool(settings.mailgun_api_key and settings.mailgun_domain)
    
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            return {"success": False, "error": "Mailgun not configured"}
        
        try:
            import httpx
            
            data = {
                "from": f"{from_name} <{from_email}>",
                "to": to_email,
                "subject": subject,
            }
            
            if body_text:
                data["text"] = body_text
            if body_html:
                data["html"] = body_html
            if reply_to:
                data["h:Reply-To"] = reply_to
            if cc_emails:
                data["cc"] = ",".join(cc_emails)
            if bcc_emails:
                data["bcc"] = ",".join(bcc_emails)
            
            with httpx.Client() as client:
                response = client.post(
                    f"https://api.mailgun.net/v3/{settings.mailgun_domain}/messages",
                    auth=("api", settings.mailgun_api_key),
                    data=data
                )
            
            if response.status_code == 200:
                result = response.json()
                return {"success": True, "message_id": result.get("id")}
            else:
                return {"success": False, "error": f"Mailgun error: {response.text}"}
                
        except ImportError:
            return {"success": False, "error": "httpx not installed. Run: pip install httpx"}
        except Exception as e:
            return {"success": False, "error": str(e)}


class AWSSESProvider(EmailProvider):
    """AWS SES email provider"""
    
    def is_configured(self) -> bool:
        return bool(settings.aws_ses_access_key and settings.aws_ses_secret_key)
    
    def send(
        self,
        to_email: str,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        from_email: str,
        from_name: str,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            return {"success": False, "error": "AWS SES not configured"}
        
        try:
            import boto3
            
            client = boto3.client(
                'ses',
                aws_access_key_id=settings.aws_ses_access_key,
                aws_secret_access_key=settings.aws_ses_secret_key,
                region_name=settings.aws_ses_region
            )
            
            destination = {"ToAddresses": [to_email]}
            if cc_emails:
                destination["CcAddresses"] = cc_emails
            if bcc_emails:
                destination["BccAddresses"] = bcc_emails
            
            body = {}
            if body_text:
                body["Text"] = {"Data": body_text, "Charset": "UTF-8"}
            if body_html:
                body["Html"] = {"Data": body_html, "Charset": "UTF-8"}
            
            kwargs = {
                "Source": f"{from_name} <{from_email}>",
                "Destination": destination,
                "Message": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": body
                }
            }
            
            if reply_to:
                kwargs["ReplyToAddresses"] = [reply_to]
            
            response = client.send_email(**kwargs)
            return {"success": True, "message_id": response.get("MessageId")}
            
        except ImportError:
            return {"success": False, "error": "boto3 not installed. Run: pip install boto3"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ============== Provider Factory ==============

def get_email_provider() -> EmailProvider:
    """Get the configured email provider"""
    provider_map = {
        "smtp": SMTPProvider,
        "sendgrid": SendGridProvider,
        "mailgun": MailgunProvider,
        "aws_ses": AWSSESProvider
    }
    
    provider_class = provider_map.get(settings.email_provider.lower(), SMTPProvider)
    return provider_class()


# ============== Email Service ==============

class EmailService:
    """Service for handling email sending and logging"""
    
    # Template variable patterns
    VARIABLE_PATTERN = re.compile(r'\{\{(\w+)\}\}')
    
    # Available template variables
    TEMPLATE_VARIABLES = {
        "lead_name": "Lead's full name",
        "lead_first_name": "Lead's first name",
        "lead_last_name": "Lead's last name",
        "lead_email": "Lead's email address",
        "lead_phone": "Lead's phone number",
        "lead_interest": "Lead's interest/product",
        "lead_budget": "Lead's budget range",
        "lead_status": "Lead's current status",
        "dealership_name": "Dealership name",
        "salesperson_name": "Salesperson's full name",
        "salesperson_first_name": "Salesperson's first name",
        "salesperson_email": "Salesperson's email",
        "salesperson_phone": "Salesperson's phone",
        "current_date": "Current date",
        "current_time": "Current time",
    }
    
    @staticmethod
    def get_available_variables() -> Dict[str, str]:
        """Return available template variables"""
        return EmailService.TEMPLATE_VARIABLES
    
    @staticmethod
    async def get_variable_values(
        db: AsyncSession,
        lead_id: Optional[UUID] = None,
        user: Optional[User] = None
    ) -> Dict[str, str]:
        """Get actual values for template variables"""
        values = {
            "current_date": datetime.now().strftime("%B %d, %Y"),
            "current_time": datetime.now().strftime("%I:%M %p"),
        }
        
        # Lead variables
        if lead_id:
            result = await db.execute(select(Lead).where(Lead.id == lead_id))
            lead = result.scalar_one_or_none()
            if lead:
                values["lead_name"] = f"{lead.first_name} {lead.last_name or ''}".strip()
                values["lead_first_name"] = lead.first_name or ""
                values["lead_last_name"] = lead.last_name or ""
                values["lead_email"] = lead.email or ""
                values["lead_phone"] = lead.phone or ""
                values["lead_interest"] = lead.interested_in or ""
                values["lead_budget"] = lead.budget_range or ""
                values["lead_status"] = lead.stage.display_name if lead.stage else ""
                
                # Get dealership name
                if lead.dealership_id:
                    from app.models.dealership import Dealership
                    dealership_result = await db.execute(
                        select(Dealership).where(Dealership.id == lead.dealership_id)
                    )
                    dealership = dealership_result.scalar_one_or_none()
                    if dealership:
                        values["dealership_name"] = dealership.name
        
        # User/Salesperson variables
        if user:
            values["salesperson_name"] = f"{user.first_name} {user.last_name}"
            values["salesperson_first_name"] = user.first_name or ""
            values["salesperson_email"] = user.email
            values["salesperson_phone"] = user.phone or ""
        
        return values
    
    @staticmethod
    def replace_variables(text: str, values: Dict[str, str]) -> str:
        """Replace template variables with actual values"""
        if not text:
            return text
            
        def replacer(match):
            var_name = match.group(1)
            return values.get(var_name, match.group(0))
        
        return EmailService.VARIABLE_PATTERN.sub(replacer, text)
    
    @staticmethod
    async def preview_email(
        db: AsyncSession,
        subject: str,
        body_text: Optional[str],
        body_html: Optional[str],
        lead_id: Optional[UUID] = None,
        user: Optional[User] = None
    ) -> Dict[str, Any]:
        """Preview email with variables replaced"""
        values = await EmailService.get_variable_values(db, lead_id, user)
        
        return {
            "subject": EmailService.replace_variables(subject, values),
            "body_text": EmailService.replace_variables(body_text, values) if body_text else None,
            "body_html": EmailService.replace_variables(body_html, values) if body_html else None,
            "to_email": values.get("lead_email"),
            "lead_name": values.get("lead_name"),
        }
    
    @staticmethod
    async def get_dealership_email_config(
        db: AsyncSession,
        dealership_id: UUID
    ) -> Optional[DealershipEmailConfig]:
        """Get email configuration for a dealership"""
        result = await db.execute(
            select(DealershipEmailConfig).where(
                DealershipEmailConfig.dealership_id == dealership_id,
                DealershipEmailConfig.is_active == True,
                DealershipEmailConfig.is_verified == True
            )
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def send_email(
        db: AsyncSession,
        *,
        from_user: User,
        to_email: str,
        subject: str,
        body_text: Optional[str] = None,
        body_html: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        lead_id: Optional[UUID] = None,
        template_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        Send an email using USER's own SMTP credentials (Hostinger).
        
        Flow:
        1. Each user configures their own Hostinger credentials in settings
        2. Email sent directly from user's email (e.g., john@dealership.com)
        3. If credentials fail, prompt user to check their config
        
        Fallback:
        - If user has no config, return error asking them to configure
        """
        try:
            # Get variable values and replace in content
            values = await EmailService.get_variable_values(db, lead_id, from_user)
            final_subject = EmailService.replace_variables(subject, values)
            final_body_text = EmailService.replace_variables(body_text, values) if body_text else None
            final_body_html = EmailService.replace_variables(body_html, values) if body_html else None
            
            # Initialize provider settings
            from_name = f"{from_user.first_name} {from_user.last_name}"
            
            # PRIORITY 1: Use User's own SMTP credentials (Hostinger)
            provider = UserSMTPProvider(from_user)
            
            if not provider.is_configured():
                # User hasn't configured their email - return helpful error
                return {
                    "success": False,
                    "message": "Email not configured. Please set up your Hostinger email credentials in Settings > Email Configuration.",
                    "config_error": True,
                    "email_log_id": None
                }
            
            from_email = from_user.smtp_email
            
            # Create email log entry
            email_log = EmailLog(
                lead_id=lead_id,
                user_id=from_user.id,
                direction=EmailDirection.SENT,
                from_email=from_email,
                to_email=to_email,
                cc_emails=",".join(cc_emails) if cc_emails else None,
                bcc_emails=",".join(bcc_emails) if bcc_emails else None,
                subject=final_subject,
                body_text=final_body_text,
                body_html=final_body_html,
                sent_at=utc_now(),
                delivery_status=None,
                attachments=[]
            )
            
            db.add(email_log)
            
            # Send via user's SMTP
            send_result = provider.send(
                to_email=to_email,
                subject=final_subject,
                body_text=final_body_text,
                body_html=final_body_html,
                from_email=from_email,
                from_name=from_name,
                reply_to=from_email,  # Reply goes back to sender's email
                cc_emails=cc_emails,
                bcc_emails=bcc_emails
            )
            
            # Update email log with message ID
            if send_result.get("message_id"):
                email_log.message_id = send_result["message_id"].strip('<>')
            
            # Log activity
            if lead_id:
                performer_name = f"{from_user.first_name} {from_user.last_name}"
                await ActivityService.log_activity(
                    db,
                    activity_type=ActivityType.EMAIL_SENT,
                    description=f"Email sent by {performer_name}: {final_subject}",
                    user_id=from_user.id,
                    lead_id=lead_id,
                    dealership_id=from_user.dealership_id,
                    meta_data={
                        "subject": final_subject,
                        "to_email": to_email,
                        "from_email": from_email,
                        "template_id": str(template_id) if template_id else None,
                        "performer_name": performer_name,
                        "delivered": send_result.get("success", False),
                        "provider": "user_smtp"
                    }
                )
            
            await db.flush()
            
            if send_result.get("success"):
                return {
                    "success": True,
                    "message": "Email sent successfully",
                    "email_log_id": email_log.id,
                    "message_id": send_result.get("message_id"),
                    "from_email": from_email
                }
            else:
                # Check if it's a configuration error
                config_error = send_result.get("config_error", False)
                error_msg = send_result.get("error", "Unknown error")
                
                return {
                    "success": False,
                    "message": error_msg,
                    "email_log_id": email_log.id,
                    "error": error_msg,
                    "config_error": config_error
                }
            
        except Exception as e:
            logger.error(f"Email send failed: {e}", exc_info=True)
            return {
                "success": False,
                "message": f"Failed to send email: {str(e)}",
                "email_log_id": None
            }
    
    @staticmethod
    def is_configured() -> bool:
        """Check if any email provider is configured"""
        provider = get_email_provider()
        return provider.is_configured()
    
    @staticmethod
    def get_provider_status() -> Dict[str, Any]:
        """Get detailed status of email configuration"""
        provider = get_email_provider()
        return {
            "provider": settings.email_provider,
            "is_configured": provider.is_configured(),
            "from_email": settings.email_from_address or settings.smtp_user or "Not configured",
            "from_name": settings.email_from_name
        }
