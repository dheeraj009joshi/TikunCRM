"""
IMAP Service for fetching incoming emails
"""
import email as email_module
import email.message
import imaplib
import logging
from dataclasses import dataclass
from datetime import datetime
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
from typing import List, Optional, Tuple

from app.models.dealership_email_config import DealershipEmailConfig

logger = logging.getLogger(__name__)


@dataclass
class IncomingEmail:
    """Represents an incoming email message"""
    uid: int
    message_id: str
    from_email: str
    from_name: str
    to_email: str
    subject: str
    body_text: str
    body_html: Optional[str]
    date: datetime
    in_reply_to: Optional[str]  # For threading
    references: Optional[str]   # For threading


class IMAPService:
    """
    Service for connecting to IMAP servers and fetching emails.
    Used for receiving email replies from leads.
    """
    
    def __init__(self, config: DealershipEmailConfig):
        """
        Initialize IMAP service with dealership email configuration.
        
        Args:
            config: DealershipEmailConfig with IMAP settings
        """
        self.host = config.imap_host
        self.port = config.imap_port
        self.username = config.imap_username or config.smtp_username
        self.password = config.imap_password or config.smtp_password
        self.use_ssl = config.imap_use_ssl
        self._connection: Optional[imaplib.IMAP4] = None
    
    def connect(self) -> bool:
        """
        Connect to the IMAP server.
        
        Returns:
            True if connection successful, False otherwise
        """
        try:
            if self.use_ssl:
                self._connection = imaplib.IMAP4_SSL(self.host, self.port)
            else:
                self._connection = imaplib.IMAP4(self.host, self.port)
            
            self._connection.login(self.username, self.password)
            logger.info(f"Connected to IMAP server {self.host}")
            return True
            
        except imaplib.IMAP4.error as e:
            logger.error(f"IMAP authentication failed: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to connect to IMAP server: {e}")
            return False
    
    def disconnect(self) -> None:
        """Close the IMAP connection."""
        if self._connection:
            try:
                self._connection.logout()
            except Exception:
                pass
            self._connection = None
    
    def _decode_header_value(self, value: str) -> str:
        """Decode email header value to string."""
        if not value:
            return ""
        
        decoded_parts = []
        for part, charset in decode_header(value):
            if isinstance(part, bytes):
                try:
                    decoded_parts.append(part.decode(charset or "utf-8", errors="replace"))
                except Exception:
                    decoded_parts.append(part.decode("utf-8", errors="replace"))
            else:
                decoded_parts.append(part)
        
        return "".join(decoded_parts)
    
    def _get_email_body(self, msg: email_module.message.Message) -> Tuple[str, Optional[str]]:
        """
        Extract text and HTML body from email message.
        
        Returns:
            Tuple of (text_body, html_body)
        """
        text_body = ""
        html_body = None
        
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition", ""))
                
                # Skip attachments
                if "attachment" in content_disposition:
                    continue
                
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        decoded = payload.decode(charset, errors="replace")
                        
                        if content_type == "text/plain":
                            text_body = decoded
                        elif content_type == "text/html":
                            html_body = decoded
                except Exception as e:
                    logger.warning(f"Failed to decode email part: {e}")
        else:
            content_type = msg.get_content_type()
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    charset = msg.get_content_charset() or "utf-8"
                    decoded = payload.decode(charset, errors="replace")
                    
                    if content_type == "text/plain":
                        text_body = decoded
                    elif content_type == "text/html":
                        html_body = decoded
                        # Extract text from HTML if no plain text
                        if not text_body:
                            import re
                            text_body = re.sub(r"<[^>]+>", "", decoded)
            except Exception as e:
                logger.warning(f"Failed to decode email body: {e}")
        
        return text_body, html_body
    
    def _parse_email(self, uid: int, raw_email: bytes) -> Optional[IncomingEmail]:
        """
        Parse a raw email into an IncomingEmail object.
        
        Args:
            uid: Email UID from IMAP
            raw_email: Raw email bytes
            
        Returns:
            IncomingEmail object or None if parsing fails
        """
        try:
            msg = email_module.message_from_bytes(raw_email)
            
            # Extract sender
            from_header = self._decode_header_value(msg.get("From", ""))
            from_name, from_email = parseaddr(from_header)
            
            # Extract recipient
            to_header = self._decode_header_value(msg.get("To", ""))
            _, to_email = parseaddr(to_header)
            
            # Extract subject
            subject = self._decode_header_value(msg.get("Subject", ""))
            
            # Extract message ID
            message_id = msg.get("Message-ID", "")
            
            # Extract threading headers
            in_reply_to = msg.get("In-Reply-To", "")
            references = msg.get("References", "")
            
            # Extract date
            date_str = msg.get("Date", "")
            try:
                date = parsedate_to_datetime(date_str)
            except Exception:
                date = datetime.utcnow()
            
            # Extract body
            text_body, html_body = self._get_email_body(msg)
            
            return IncomingEmail(
                uid=uid,
                message_id=message_id,
                from_email=from_email.lower(),
                from_name=from_name or from_email.split("@")[0],
                to_email=to_email.lower(),
                subject=subject,
                body_text=text_body,
                body_html=html_body,
                date=date,
                in_reply_to=in_reply_to,
                references=references,
            )
            
        except Exception as e:
            logger.error(f"Failed to parse email UID {uid}: {e}")
            return None
    
    def fetch_emails_since_uid(
        self,
        since_uid: Optional[int] = None,
        folder: str = "INBOX",
        limit: int = 100
    ) -> List[IncomingEmail]:
        """
        Fetch emails from the specified folder, optionally since a given UID.
        
        Args:
            since_uid: Only fetch emails with UID greater than this
            folder: IMAP folder to fetch from (default: INBOX)
            limit: Maximum number of emails to fetch
            
        Returns:
            List of IncomingEmail objects
        """
        if not self._connection:
            if not self.connect():
                return []
        
        emails = []
        
        try:
            # Select the folder
            status, _ = self._connection.select(folder, readonly=True)
            if status != "OK":
                logger.error(f"Failed to select folder {folder}")
                return []
            
            # Build search criteria
            if since_uid:
                # Fetch emails with UID greater than since_uid
                search_criteria = f"UID {since_uid + 1}:*"
            else:
                # Fetch all emails (limited)
                search_criteria = "ALL"
            
            # Search for emails
            status, message_numbers = self._connection.uid("search", None, search_criteria)
            if status != "OK":
                logger.error("Failed to search emails")
                return []
            
            # Get UIDs
            uids = message_numbers[0].split()
            if not uids:
                return []
            
            # Limit the number of emails
            uids = uids[-limit:]  # Get the most recent emails
            
            # Fetch each email
            for uid in uids:
                uid_str = uid.decode() if isinstance(uid, bytes) else uid
                
                # Skip if UID is not greater than since_uid
                if since_uid and int(uid_str) <= since_uid:
                    continue
                
                status, msg_data = self._connection.uid("fetch", uid, "(RFC822)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue
                
                raw_email = msg_data[0][1] if isinstance(msg_data[0], tuple) else None
                if raw_email:
                    parsed = self._parse_email(int(uid_str), raw_email)
                    if parsed:
                        emails.append(parsed)
            
            logger.info(f"Fetched {len(emails)} emails from {folder}")
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails: {e}")
            return []
    
    def get_latest_uid(self, folder: str = "INBOX") -> Optional[int]:
        """
        Get the UID of the latest email in the folder.
        
        Args:
            folder: IMAP folder to check
            
        Returns:
            Latest UID or None
        """
        if not self._connection:
            if not self.connect():
                return None
        
        try:
            status, _ = self._connection.select(folder, readonly=True)
            if status != "OK":
                return None
            
            status, message_numbers = self._connection.uid("search", None, "ALL")
            if status != "OK" or not message_numbers or not message_numbers[0]:
                return None
            
            uids = message_numbers[0].split()
            if uids:
                return int(uids[-1].decode() if isinstance(uids[-1], bytes) else uids[-1])
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting latest UID: {e}")
            return None
    
    def __enter__(self):
        """Context manager entry."""
        self.connect()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.disconnect()
        return False
