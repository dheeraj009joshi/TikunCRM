"""
Gmail Integration Service
"""
import base64
from email.message import EmailMessage
from typing import Any, Dict, List, Optional
from uuid import UUID

from googleapiclient.discovery import build
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.google_auth import GoogleAuthService
from app.services.email import EmailService
from app.models.lead import Lead


class GmailService:
    """Service for interacting with Gmail API"""

    @staticmethod
    async def send_email(
        db: AsyncSession,
        user_id: UUID,
        lead: Lead,
        subject: str,
        body: str
    ) -> Dict[str, Any]:
        """Send an email via Gmail API and log it"""
        creds = await GoogleAuthService.get_credentials(db, user_id)
        if not creds:
            raise Exception("Google account not connected")

        service = build("gmail", "v1", credentials=creds)

        message = EmailMessage()
        message.set_content(body)
        message["To"] = lead.email
        message["Subject"] = subject

        # Encoded message
        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        create_message = {"raw": encoded_message}

        # Send request
        send_request = service.users().messages().send(userId="me", body=create_message).execute()
        
        # Log to database
        await EmailService.log_email(
            db,
            lead_id=lead.id,
            user_id=user_id,
            subject=subject,
            body=body,
            direction="sent",
            gmail_message_id=send_request.get("id")
        )

        return send_request

    @staticmethod
    async def sync_emails(
        db: AsyncSession,
        user_id: UUID,
        lead_email: str
    ) -> List[Dict[str, Any]]:
        """Sync recent emails with a specific lead from Gmail"""
        creds = await GoogleAuthService.get_credentials(db, user_id)
        if not creds:
            return []

        service = build("gmail", "v1", credentials=creds)
        
        # Search for messages with the lead
        query = f"from:{lead_email} OR to:{lead_email}"
        results = service.users().messages().list(userId="me", q=query, maxResults=10).execute()
        messages = results.get("messages", [])

        synced_emails = []
        for msg in messages:
            # Check if already synced in DB (optimization omitted for MVP)
            msg_data = service.users().messages().get(userId="me", id=msg["id"]).execute()
            
            # Simple metadata extraction
            headers = msg_data.get("payload", {}).get("headers", [])
            subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "No Subject")
            
            # This is a placeholder for actual body extraction which can be complex in Gmail
            body_snippet = msg_data.get("snippet", "")
            
            synced_emails.append({
                "id": msg["id"],
                "subject": subject,
                "snippet": body_snippet,
                "internal_date": int(msg_data.get("internalDate", 0)) / 1000
            })

        return synced_emails
