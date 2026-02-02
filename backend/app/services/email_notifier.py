"""
Email Notifier Service
Sends email notifications to users when they receive replies
"""
import logging
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.models.lead import Lead
from app.models.dealership_email_config import DealershipEmailConfig

logger = logging.getLogger(__name__)


class EmailNotifier:
    """
    Service for sending email notifications to users.
    Used to alert users when they receive email replies from leads.
    """
    
    @staticmethod
    async def send_reply_notification(
        db: AsyncSession,
        user: User,
        lead_name: str,
        lead_id: str,
        email_preview: Optional[str] = None,
        lead_email: Optional[str] = None
    ) -> bool:
        """
        Send an email notification to a user about a new reply.
        
        Args:
            db: Database session
            user: User to notify
            lead_name: Name of the lead who replied
            lead_id: ID of the lead for the link
            email_preview: Preview of the email content
            lead_email: Email address of the lead
            
        Returns:
            True if notification sent successfully
        """
        # Don't send if user doesn't have an email to notify
        if not user.email:
            logger.warning(f"Cannot send notification - user {user.id} has no email")
            return False
        
        try:
            # Build notification email
            subject = f"New reply from {lead_name}"
            
            # Create the CRM link
            crm_link = f"{settings.frontend_url}/leads/{lead_id}"
            
            # Text version
            body_text = f"""
Hello {user.first_name},

You have received a new email reply from {lead_name}.

{f'Preview: {email_preview[:300]}...' if email_preview and len(email_preview) > 300 else f'Preview: {email_preview}' if email_preview else ''}

View the full conversation in LeedsCRM:
{crm_link}

---
This is an automated notification from LeedsCRM.
            """.strip()
            
            # HTML version
            body_html = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }}
        .preview {{ background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #2563eb; }}
        .button {{ display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }}
        .footer {{ color: #6b7280; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2 style="margin: 0;">New Reply Received</h2>
        </div>
        <div class="content">
            <p>Hello {user.first_name},</p>
            <p>You have received a new email reply from <strong>{lead_name}</strong>{f' ({lead_email})' if lead_email else ''}.</p>
            
            {f'''
            <div class="preview">
                <p style="margin: 0; color: #4b5563;">{email_preview[:300]}{'...' if len(email_preview) > 300 else ''}</p>
            </div>
            ''' if email_preview else ''}
            
            <a href="{crm_link}" class="button">View Conversation</a>
            
            <div class="footer">
                <p>This is an automated notification from LeedsCRM.</p>
            </div>
        </div>
    </div>
</body>
</html>
            """
            
            # Try to send via dealership SMTP first, then fall back to system
            sent = False
            
            if user.dealership_id:
                sent = await EmailNotifier._send_via_dealership(
                    db, user.dealership_id, user.email, subject, body_text, body_html
                )
            
            if not sent:
                sent = EmailNotifier._send_via_system(
                    user.email, subject, body_text, body_html
                )
            
            if sent:
                logger.info(f"Reply notification sent to {user.email}")
            else:
                logger.warning(f"Failed to send reply notification to {user.email}")
            
            return sent
            
        except Exception as e:
            logger.error(f"Error sending reply notification: {e}")
            return False
    
    @staticmethod
    async def _send_via_dealership(
        db: AsyncSession,
        dealership_id: str,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str
    ) -> bool:
        """Send notification using dealership SMTP."""
        try:
            # Get dealership email config
            result = await db.execute(
                select(DealershipEmailConfig).where(
                    DealershipEmailConfig.dealership_id == dealership_id,
                    DealershipEmailConfig.is_active == True,
                    DealershipEmailConfig.is_verified == True
                )
            )
            config = result.scalar_one_or_none()
            
            if not config:
                return False
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = formataddr((config.from_name or "LeedsCRM", config.smtp_username))
            msg['To'] = to_email
            
            msg.attach(MIMEText(body_text, 'plain'))
            msg.attach(MIMEText(body_html, 'html'))
            
            password = config.smtp_password
            
            if config.smtp_use_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, context=context) as server:
                    server.login(config.smtp_username, password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(config.smtp_host, config.smtp_port) as server:
                    if config.smtp_use_tls:
                        context = ssl.create_default_context()
                        server.starttls(context=context)
                    server.login(config.smtp_username, password)
                    server.send_message(msg)
            
            return True
            
        except Exception as e:
            logger.error(f"Error sending via dealership SMTP: {e}")
            return False
    
    @staticmethod
    def _send_via_system(
        to_email: str,
        subject: str,
        body_text: str,
        body_html: str
    ) -> bool:
        """Send notification using system SMTP settings."""
        if not settings.smtp_user or not settings.smtp_password:
            return False
        
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = formataddr((settings.email_from_name, settings.smtp_user))
            msg['To'] = to_email
            
            msg.attach(MIMEText(body_text, 'plain'))
            msg.attach(MIMEText(body_html, 'html'))
            
            if settings.smtp_use_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context) as server:
                    server.login(settings.smtp_user, settings.smtp_password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                    if settings.smtp_use_tls:
                        context = ssl.create_default_context()
                        server.starttls(context=context)
                    server.login(settings.smtp_user, settings.smtp_password)
                    server.send_message(msg)
            
            return True
            
        except Exception as e:
            logger.error(f"Error sending via system SMTP: {e}")
            return False
