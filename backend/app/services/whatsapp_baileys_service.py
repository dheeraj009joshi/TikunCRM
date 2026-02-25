"""
WhatsApp Baileys Service - Communicates with Node.js Baileys service
"""
import re
import uuid
import httpx
from typing import Optional
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, func, and_, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.whatsapp_message import (
    WhatsAppMessage,
    WhatsAppBulkSend,
    WhatsAppConnection,
    WhatsAppChannel,
)
from app.models.whatsapp_log import WhatsAppDirection, WhatsAppStatus
from app.models.customer import Customer
from app.models.lead import Lead

import logging

logger = logging.getLogger(__name__)


class WhatsAppBaileysService:
    """Service for WhatsApp messaging via Baileys."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.base_url = settings.baileys_service_url

    async def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[dict] = None,
        timeout: float = 30.0
    ) -> dict:
        """Make HTTP request to Baileys service."""
        url = f"{self.base_url}{endpoint}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if method.upper() == "GET":
                    response = await client.get(url)
                elif method.upper() == "POST":
                    response = await client.post(url, json=data)
                else:
                    raise ValueError(f"Unsupported method: {method}")

                response.raise_for_status()
                return response.json()
        except httpx.ConnectError:
            logger.error(f"Cannot connect to Baileys service at {url}")
            return {"success": False, "error": "Baileys service not available"}
        except httpx.HTTPStatusError as e:
            logger.error(f"Baileys service error: {e.response.text}")
            return {"success": False, "error": e.response.text}
        except Exception as e:
            logger.error(f"WhatsApp service error: {str(e)}")
            return {"success": False, "error": str(e)}

    async def get_status(self) -> dict:
        """Get WhatsApp connection status."""
        return await self._make_request("GET", "/status")

    async def get_qr_code(self) -> dict:
        """Get QR code for authentication."""
        result = await self._make_request("GET", "/qr/base64")
        
        # Handle both old 'qrImage' field and new 'qr' field from WPPConnect
        qr_value = result.get("qr") or result.get("qrImage")
        if qr_value:
            # Extract base64 from data URL if present
            if qr_value.startswith("data:image/png;base64,"):
                result["qr"] = qr_value.replace("data:image/png;base64,", "")
            else:
                result["qr"] = qr_value
        
        return result

    async def disconnect(self) -> dict:
        """Disconnect WhatsApp session."""
        return await self._make_request("POST", "/disconnect")

    async def reconnect(self) -> dict:
        """Reconnect WhatsApp session."""
        return await self._make_request("POST", "/reconnect")

    async def check_number(self, phone: str) -> dict:
        """Check if phone number is on WhatsApp."""
        return await self._make_request("POST", "/send/check-number", {"phone": phone})

    def _normalize_phone(self, phone: str) -> str:
        """Normalize phone number to digits only for consistent storage."""
        return "".join(filter(str.isdigit, phone))

    def _get_phone_suffix(self, phone: str, length: int = 10) -> str:
        """Get last N digits of phone for matching (handles country code variations)."""
        digits = self._normalize_phone(phone)
        return digits[-length:] if len(digits) >= length else digits

    async def _lookup_customer_lead(
        self,
        phone: str,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> tuple[Optional[UUID], Optional[UUID], Optional[UUID]]:
        """Auto-lookup customer and lead if not provided."""
        normalized_phone = self._normalize_phone(phone)
        
        if not customer_id:
            customer_query = select(Customer).where(
                or_(
                    Customer.phone == phone,
                    Customer.phone == normalized_phone,
                    func.regexp_replace(Customer.phone, '[^0-9]', '', 'g') == normalized_phone,
                )
            ).limit(1)
            customer_result = await self.session.execute(customer_query)
            customer = customer_result.scalar_one_or_none()
            
            if customer:
                customer_id = customer.id
                if not lead_id:
                    lead_query = select(Lead).where(
                        Lead.customer_id == customer.id
                    ).order_by(Lead.created_at.desc()).limit(1)
                    lead_result = await self.session.execute(lead_query)
                    lead = lead_result.scalar_one_or_none()
                    if lead:
                        lead_id = lead.id
                        dealership_id = dealership_id or lead.dealership_id
        
        return customer_id, lead_id, dealership_id

    async def send_message(
        self,
        phone: str,
        message: str,
        user_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        bulk_send_id: Optional[UUID] = None,
        quoted_msg_id: Optional[str] = None,
    ) -> dict:
        """Send a single WhatsApp text message."""
        normalized_phone = self._normalize_phone(phone)
        customer_id, lead_id, dealership_id = await self._lookup_customer_lead(
            phone, customer_id, lead_id, dealership_id
        )
        
        payload = {"phone": phone, "message": message}
        if quoted_msg_id:
            payload["quotedMsgId"] = quoted_msg_id
        
        result = await self._make_request("POST", "/send", payload)

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            wa_message_id=result.get("messageId"),
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            from_number=result.get("from"),
            to_number=normalized_phone,
            direction=WhatsAppDirection.OUTBOUND,
            body=message,
            status=WhatsAppStatus.SENT if result.get("success") else WhatsAppStatus.FAILED,
            error_message=result.get("error"),
            bulk_send_id=bulk_send_id,
            sent_at=utc_now() if result.get("success") else None,
            meta_data=result,
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()

        return {
            "success": result.get("success", False),
            "message_id": str(wa_message.id),
            "wa_message_id": result.get("messageId"),
            "error": result.get("error"),
        }

    async def send_image(
        self,
        phone: str,
        image: str,
        filename: Optional[str] = "image.jpg",
        caption: Optional[str] = None,
        user_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> dict:
        """Send an image message via WhatsApp."""
        normalized_phone = self._normalize_phone(phone)
        customer_id, lead_id, dealership_id = await self._lookup_customer_lead(
            phone, customer_id, lead_id, dealership_id
        )
        
        result = await self._make_request("POST", "/send/image", {
            "phone": phone,
            "image": image,
            "filename": filename,
            "caption": caption or "",
        }, timeout=60.0)

        # Create data URL for storage
        media_url = f"data:image/jpeg;base64,{image}" if image and not image.startswith("data:") else image

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            wa_message_id=result.get("messageId"),
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            to_number=normalized_phone,
            direction=WhatsAppDirection.OUTBOUND,
            body=caption,
            media_url=media_url,
            media_type="image",
            status=WhatsAppStatus.SENT if result.get("success") else WhatsAppStatus.FAILED,
            error_message=result.get("error"),
            sent_at=utc_now() if result.get("success") else None,
            meta_data={"filename": filename},
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()

        return {
            "success": result.get("success", False),
            "message_id": str(wa_message.id),
            "wa_message_id": result.get("messageId"),
            "error": result.get("error"),
        }

    async def send_file(
        self,
        phone: str,
        file: str,
        filename: str,
        caption: Optional[str] = None,
        user_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> dict:
        """Send a file/document via WhatsApp."""
        normalized_phone = self._normalize_phone(phone)
        customer_id, lead_id, dealership_id = await self._lookup_customer_lead(
            phone, customer_id, lead_id, dealership_id
        )
        
        result = await self._make_request("POST", "/send/file", {
            "phone": phone,
            "file": file,
            "filename": filename,
            "caption": caption or "",
        }, timeout=120.0)

        # Determine mime type from filename
        ext = filename.lower().split(".")[-1] if "." in filename else ""
        mime_types = {
            "pdf": "application/pdf",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls": "application/vnd.ms-excel",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "txt": "text/plain",
            "zip": "application/zip",
        }
        mime_type = mime_types.get(ext, "application/octet-stream")
        media_url = f"data:{mime_type};base64,{file}" if file and not file.startswith("data:") else file

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            wa_message_id=result.get("messageId"),
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            to_number=normalized_phone,
            direction=WhatsAppDirection.OUTBOUND,
            body=caption or filename,
            media_url=media_url,
            media_type="document",
            status=WhatsAppStatus.SENT if result.get("success") else WhatsAppStatus.FAILED,
            error_message=result.get("error"),
            sent_at=utc_now() if result.get("success") else None,
            meta_data={"filename": filename},
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()

        return {
            "success": result.get("success", False),
            "message_id": str(wa_message.id),
            "wa_message_id": result.get("messageId"),
            "error": result.get("error"),
        }

    async def send_audio(
        self,
        phone: str,
        audio: str,
        is_ptt: bool = True,
        user_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> dict:
        """Send an audio/voice message via WhatsApp."""
        normalized_phone = self._normalize_phone(phone)
        customer_id, lead_id, dealership_id = await self._lookup_customer_lead(
            phone, customer_id, lead_id, dealership_id
        )

        result = await self._make_request("POST", "/send/audio", {
            "phone": phone,
            "audio": audio,
            "isPtt": is_ptt,
        }, timeout=60.0)

        # Create data URL for storage
        media_url = f"data:audio/ogg;base64,{audio}" if audio and not audio.startswith("data:") else audio

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            wa_message_id=result.get("messageId"),
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            to_number=normalized_phone,
            direction=WhatsAppDirection.OUTBOUND,
            media_url=media_url,
            media_type="audio",
            status=WhatsAppStatus.SENT if result.get("success") else WhatsAppStatus.FAILED,
            error_message=result.get("error"),
            sent_at=utc_now() if result.get("success") else None,
            meta_data={"is_ptt": is_ptt},
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()

        return {
            "success": result.get("success", False),
            "message_id": str(wa_message.id),
            "wa_message_id": result.get("messageId"),
            "error": result.get("error"),
        }

    async def send_video(
        self,
        phone: str,
        video: str,
        filename: Optional[str] = "video.mp4",
        caption: Optional[str] = None,
        user_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> dict:
        """Send a video message via WhatsApp."""
        normalized_phone = self._normalize_phone(phone)
        customer_id, lead_id, dealership_id = await self._lookup_customer_lead(
            phone, customer_id, lead_id, dealership_id
        )

        result = await self._make_request("POST", "/send/video", {
            "phone": phone,
            "video": video,
            "filename": filename,
            "caption": caption or "",
        }, timeout=120.0)

        # Create data URL for storage
        media_url = f"data:video/mp4;base64,{video}" if video and not video.startswith("data:") else video

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            wa_message_id=result.get("messageId"),
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            to_number=normalized_phone,
            direction=WhatsAppDirection.OUTBOUND,
            body=caption,
            media_url=media_url,
            media_type="video",
            status=WhatsAppStatus.SENT if result.get("success") else WhatsAppStatus.FAILED,
            error_message=result.get("error"),
            sent_at=utc_now() if result.get("success") else None,
            meta_data={"filename": filename},
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()

        return {
            "success": result.get("success", False),
            "message_id": str(wa_message.id),
            "wa_message_id": result.get("messageId"),
            "error": result.get("error"),
        }

    async def send_location(
        self,
        phone: str,
        latitude: float,
        longitude: float,
        title: Optional[str] = None,
        address: Optional[str] = None,
        user_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
    ) -> dict:
        """Send a location message via WhatsApp."""
        normalized_phone = self._normalize_phone(phone)
        customer_id, lead_id, dealership_id = await self._lookup_customer_lead(
            phone, customer_id, lead_id, dealership_id
        )
        
        result = await self._make_request("POST", "/send/location", {
            "phone": phone,
            "latitude": latitude,
            "longitude": longitude,
            "title": title or "",
            "address": address or "",
        })

        body = f"Location: {latitude}, {longitude}"
        if title:
            body = f"{title} - {body}"

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            user_id=user_id,
            dealership_id=dealership_id,
            wa_message_id=result.get("messageId"),
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            to_number=normalized_phone,
            direction=WhatsAppDirection.OUTBOUND,
            body=body,
            media_type="location",
            status=WhatsAppStatus.SENT if result.get("success") else WhatsAppStatus.FAILED,
            error_message=result.get("error"),
            sent_at=utc_now() if result.get("success") else None,
            meta_data={**result, "latitude": latitude, "longitude": longitude, "title": title, "address": address},
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()

        return {
            "success": result.get("success", False),
            "message_id": str(wa_message.id),
            "wa_message_id": result.get("messageId"),
            "error": result.get("error"),
        }

    async def send_reaction(
        self,
        message_id: str,
        emoji: str,
    ) -> dict:
        """Send a reaction to a message."""
        result = await self._make_request("POST", "/send/reaction", {
            "messageId": message_id,
            "emoji": emoji,
        })

        return {
            "success": result.get("success", False),
            "error": result.get("error"),
        }

    async def mark_messages_as_read(
        self,
        phone: str,
        message_ids: list[str] = None,
    ) -> dict:
        """Mark messages as read in WhatsApp (send read receipts)."""
        result = await self._make_request("POST", "/messages/read", {
            "phone": phone,
            "messageIds": message_ids or [],
        })

        if result.get("success") and message_ids:
            await self.session.execute(
                update(WhatsAppMessage)
                .where(WhatsAppMessage.wa_message_id.in_(message_ids))
                .values(is_read=True)
            )
            await self.session.flush()

        return {
            "success": result.get("success", False),
            "count": result.get("count", 0),
            "error": result.get("error"),
        }

    async def send_bulk_messages(
        self,
        recipients: list[dict],
        message: str,
        user_id: UUID,
        dealership_id: Optional[UUID] = None,
        name: Optional[str] = None,
        filter_criteria: Optional[dict] = None,
        min_delay: int = 5,
        max_delay: int = 30,
        media: Optional[str] = None,
        media_type: Optional[str] = None,
        media_filename: Optional[str] = None,
    ) -> dict:
        """Send bulk WhatsApp messages with optional media."""
        bulk_send = WhatsAppBulkSend(
            id=uuid.uuid4(),
            user_id=user_id,
            dealership_id=dealership_id,
            name=name or f"Bulk Send {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            message_template=message or f"[{media_type or 'media'}]",
            filter_criteria=filter_criteria or {},
            total_recipients=len(recipients),
            status="in_progress",
            started_at=utc_now(),
            created_at=utc_now(),
        )
        self.session.add(bulk_send)
        await self.session.flush()

        phones = [r["phone"] for r in recipients]
        
        # Build request payload
        payload = {
            "recipients": phones,
            "message": message or "",
            "minDelay": min_delay,
            "maxDelay": max_delay,
        }
        
        # Add media if provided
        if media:
            payload["media"] = media
            payload["mediaType"] = media_type
            payload["mediaFilename"] = media_filename
        
        result = await self._make_request(
            "POST",
            "/send/bulk",
            payload,
            timeout=len(phones) * max_delay + 60
        )

        sent_count = 0
        failed_count = 0
        
        # Build results map with multiple phone formats for flexible matching
        results_list = result.get("results", [])
        results_map = {}
        for r in results_list:
            result_phone = r.get("phone", "")
            # Store with various normalizations for flexible lookup
            results_map[result_phone] = r
            normalized = re.sub(r'[^0-9]', '', result_phone)
            results_map[normalized] = r
            if len(normalized) >= 10:
                results_map[normalized[-10:]] = r  # Last 10 digits

        for recipient in recipients:
            phone = recipient["phone"]
            normalized_phone = self._normalize_phone(phone)
            phone_suffix = self._get_phone_suffix(normalized_phone)
            
            # Try multiple formats to find the result
            send_result = (
                results_map.get(phone) or 
                results_map.get(normalized_phone) or 
                results_map.get(phone_suffix) or 
                {}
            )
            success = send_result.get("success", False)

            wa_message = WhatsAppMessage(
                id=uuid.uuid4(),
                customer_id=recipient.get("customer_id"),
                lead_id=recipient.get("lead_id"),
                user_id=user_id,
                dealership_id=dealership_id,
                wa_message_id=send_result.get("messageId"),
                channel=WhatsAppChannel.BAILEYS,
                phone_number=normalized_phone,
                to_number=normalized_phone,
                direction=WhatsAppDirection.OUTBOUND,
                body=message or "",
                media_url=media if media else None,
                media_type=media_type if media else None,
                status=WhatsAppStatus.SENT if success else WhatsAppStatus.FAILED,
                error_message=send_result.get("error"),
                bulk_send_id=bulk_send.id,
                sent_at=utc_now() if success else None,
                meta_data={**send_result, "filename": media_filename} if media_filename else send_result,
                created_at=utc_now(),
            )
            self.session.add(wa_message)

            if success:
                sent_count += 1
            else:
                failed_count += 1

        bulk_send.sent_count = sent_count
        bulk_send.failed_count = failed_count
        bulk_send.status = "completed"
        bulk_send.completed_at = utc_now()
        
        await self.session.flush()

        return {
            "success": True,
            "bulk_send_id": str(bulk_send.id),
            "total": len(recipients),
            "sent": sent_count,
            "failed": failed_count,
        }

    async def store_incoming_message(
        self,
        phone: str,
        body: str,
        wa_message_id: Optional[str] = None,
        media_url: Optional[str] = None,
        media_type: Optional[str] = None,
        meta_data: Optional[dict] = None,
    ) -> WhatsAppMessage:
        """Store an incoming WhatsApp message (called from webhook)."""
        customer_id = None
        lead_id = None
        dealership_id = None

        # Normalize phone for consistent storage
        normalized_phone = self._normalize_phone(phone)
        phone_suffix = self._get_phone_suffix(normalized_phone)

        # First try to find customer by phone suffix
        customer_query = select(Customer).where(
            func.right(
                func.regexp_replace(Customer.phone, '[^0-9]', '', 'g'),
                10
            ) == phone_suffix
        ).limit(1)
        customer_result = await self.session.execute(customer_query)
        customer = customer_result.scalar_one_or_none()

        if customer:
            customer_id = customer.id
            lead_query = select(Lead).where(
                Lead.customer_id == customer.id
            ).order_by(Lead.created_at.desc()).limit(1)
            lead_result = await self.session.execute(lead_query)
            lead = lead_result.scalar_one_or_none()
            if lead:
                lead_id = lead.id
                dealership_id = lead.dealership_id

        wa_message = WhatsAppMessage(
            id=uuid.uuid4(),
            customer_id=customer_id,
            lead_id=lead_id,
            dealership_id=dealership_id,
            wa_message_id=wa_message_id,
            channel=WhatsAppChannel.BAILEYS,
            phone_number=normalized_phone,
            from_number=normalized_phone,
            direction=WhatsAppDirection.INBOUND,
            body=body,
            media_url=media_url,
            media_type=media_type,
            status=WhatsAppStatus.RECEIVED,
            received_at=utc_now(),
            meta_data=meta_data or {},
            created_at=utc_now(),
        )
        self.session.add(wa_message)
        await self.session.flush()
        
        return wa_message

    async def update_message_status(
        self,
        wa_message_id: str,
        status: str,
    ) -> bool:
        """Update message status (called from webhook when status changes)."""
        query = select(WhatsAppMessage).where(
            WhatsAppMessage.wa_message_id == wa_message_id
        )
        result = await self.session.execute(query)
        message = result.scalar_one_or_none()

        if not message:
            logger.warning(f"Message not found for status update: {wa_message_id}")
            return False

        status_map = {
            "sent": WhatsAppStatus.SENT,
            "delivered": WhatsAppStatus.DELIVERED,
            "read": WhatsAppStatus.READ,
            "failed": WhatsAppStatus.FAILED,
        }

        new_status = status_map.get(status.lower())
        if not new_status:
            logger.warning(f"Unknown status: {status}")
            return False

        message.status = new_status
        message.updated_at = utc_now()

        if status.lower() == "delivered":
            message.delivered_at = utc_now()
        elif status.lower() == "read":
            message.delivered_at = message.delivered_at or utc_now()
            message.read_at = utc_now()

        await self.session.flush()
        logger.info(f"Updated message {wa_message_id} status to {status}")
        return True

    async def get_conversations(
        self,
        dealership_id: Optional[UUID] = None,
        limit: int = 50,
        offset: int = 0,
        admin_initiated_only: bool = True,
    ) -> list[dict]:
        """
        Get list of conversations (unique phone numbers with latest message).
        Groups by last 10 digits to consolidate duplicates (e.g., +1234... and 1234...).
        
        Args:
            admin_initiated_only: If True, only show conversations where admin sent at least one message.
        """
        # SQL expression for normalized phone suffix (last 10 digits)
        phone_suffix = func.right(
            func.regexp_replace(WhatsAppMessage.phone_number, '[^0-9]', '', 'g'),
            10
        )
        
        # First, get phone suffixes that have at least one outbound (admin-initiated) message
        if admin_initiated_only:
            outbound_suffixes_query = (
                select(phone_suffix.label("phone_suffix"))
                .where(
                    and_(
                        WhatsAppMessage.channel == WhatsAppChannel.BAILEYS,
                        WhatsAppMessage.direction == WhatsAppDirection.OUTBOUND,
                    )
                )
                .distinct()
            )
            if dealership_id:
                outbound_suffixes_query = outbound_suffixes_query.where(
                    WhatsAppMessage.dealership_id == dealership_id
                )
            outbound_result = await self.session.execute(outbound_suffixes_query)
            admin_initiated_suffixes = {row[0] for row in outbound_result.all()}
            
            if not admin_initiated_suffixes:
                return []
        
        # Get latest message for each phone suffix (last 10 digits)
        subquery = (
            select(
                phone_suffix.label("phone_suffix"),
                func.max(WhatsAppMessage.created_at).label("latest_at")
            )
            .where(WhatsAppMessage.channel == WhatsAppChannel.BAILEYS)
        )
        if dealership_id:
            subquery = subquery.where(WhatsAppMessage.dealership_id == dealership_id)
        
        # Filter to only admin-initiated conversations
        if admin_initiated_only:
            subquery = subquery.where(phone_suffix.in_(admin_initiated_suffixes))
        
        subquery = subquery.group_by(phone_suffix).subquery()

        # Join back to get the actual message with latest timestamp per suffix
        query = (
            select(WhatsAppMessage)
            .join(
                subquery,
                and_(
                    phone_suffix == subquery.c.phone_suffix,
                    WhatsAppMessage.created_at == subquery.c.latest_at
                )
            )
            .options(selectinload(WhatsAppMessage.customer))
            .order_by(WhatsAppMessage.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        
        result = await self.session.execute(query)
        messages = result.scalars().all()

        # Deduplicate by phone suffix in case of same-timestamp duplicates
        seen_suffixes = set()
        unique_messages = []
        for msg in messages:
            suffix = self._get_phone_suffix(msg.phone_number)
            if suffix not in seen_suffixes:
                seen_suffixes.add(suffix)
                unique_messages.append(msg)

        conversations = []
        for msg in unique_messages:
            # Get unread count for all messages matching this phone suffix
            msg_suffix = self._get_phone_suffix(msg.phone_number)
            unread_query = select(func.count()).select_from(WhatsAppMessage).where(
                and_(
                    func.right(
                        func.regexp_replace(WhatsAppMessage.phone_number, '[^0-9]', '', 'g'),
                        10
                    ) == msg_suffix,
                    WhatsAppMessage.direction == WhatsAppDirection.INBOUND,
                    WhatsAppMessage.is_read == False,
                )
            )
            unread_result = await self.session.execute(unread_query)
            unread_count = unread_result.scalar() or 0

            # Get customer name - first try from message, then lookup by phone
            customer_name = None
            customer_id = msg.customer_id
            lead_name = None
            lead_id = msg.lead_id
            
            if msg.customer:
                customer_name = msg.customer.full_name
            elif msg.phone_number:
                # Look up customer by normalized phone (last 10 digits match)
                normalized_phone = self._normalize_phone(msg.phone_number)
                phone_suffix_str = normalized_phone[-10:] if len(normalized_phone) >= 10 else normalized_phone
                customer_query = select(Customer).where(
                    func.right(
                        func.regexp_replace(Customer.phone, '[^0-9]', '', 'g'),
                        10
                    ) == phone_suffix_str
                ).limit(1)
                customer_result = await self.session.execute(customer_query)
                customer = customer_result.scalar_one_or_none()
                if customer:
                    customer_name = customer.full_name or f"{customer.first_name} {customer.last_name}".strip()
                    customer_id = customer.id

            # Also lookup lead via customer (Lead.phone is a property, not a column)
            if not lead_id and customer_id:
                lead_query = select(Lead).where(
                    Lead.customer_id == customer_id
                ).order_by(Lead.created_at.desc()).limit(1)
                lead_result = await self.session.execute(lead_query)
                lead = lead_result.scalar_one_or_none()
                if lead:
                    lead_name = lead.full_name or f"{lead.first_name or ''} {lead.last_name or ''}".strip()
                    lead_id = lead.id

            conversations.append({
                "phone_number": msg.phone_number,
                "customer_id": str(customer_id) if customer_id else None,
                "customer_name": customer_name,
                "lead_id": str(lead_id) if lead_id else None,
                "lead_name": lead_name,
                "last_message": msg.body,
                "last_message_at": msg.created_at.isoformat() if msg.created_at else None,
                "direction": msg.direction.value,
                "last_message_status": msg.status.value if msg.direction == WhatsAppDirection.OUTBOUND else None,
                "unread_count": unread_count,
            })

        return conversations

    async def get_messages(
        self,
        phone_number: str,
        limit: int = 100,
        offset: int = 0,
        mark_as_read: bool = True,
    ) -> list[dict]:
        """Get messages for a specific phone number (matches by last 10 digits)."""
        # Match by last 10 digits to consolidate messages from different phone formats
        phone_suffix = self._get_phone_suffix(phone_number)
        
        query = (
            select(WhatsAppMessage)
            .where(
                and_(
                    func.right(
                        func.regexp_replace(WhatsAppMessage.phone_number, '[^0-9]', '', 'g'),
                        10
                    ) == phone_suffix,
                    WhatsAppMessage.channel == WhatsAppChannel.BAILEYS,
                )
            )
            .order_by(WhatsAppMessage.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        
        result = await self.session.execute(query)
        messages = result.scalars().all()

        if mark_as_read:
            for msg in messages:
                if msg.direction == WhatsAppDirection.INBOUND and not msg.is_read:
                    msg.is_read = True
                    msg.read_at = utc_now()
            await self.session.flush()

        return [
            {
                "id": str(msg.id),
                "wa_message_id": msg.wa_message_id,
                "direction": msg.direction.value,
                "body": msg.body,
                "media_url": msg.media_url,
                "media_type": msg.media_type,
                "status": msg.status.value,
                "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
                "received_at": msg.received_at.isoformat() if msg.received_at else None,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                "is_read": msg.is_read,
            }
            for msg in reversed(messages)
        ]

    async def get_bulk_sends(
        self,
        user_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict]:
        """Get bulk send history."""
        query = select(WhatsAppBulkSend).order_by(WhatsAppBulkSend.created_at.desc())
        
        if user_id:
            query = query.where(WhatsAppBulkSend.user_id == user_id)
        if dealership_id:
            query = query.where(WhatsAppBulkSend.dealership_id == dealership_id)
            
        query = query.limit(limit).offset(offset)
        
        result = await self.session.execute(query)
        bulk_sends = result.scalars().all()

        return [
            {
                "id": str(bs.id),
                "name": bs.name,
                "message_template": bs.message_template[:100] + "..." if len(bs.message_template) > 100 else bs.message_template,
                "total_recipients": bs.total_recipients,
                "sent_count": bs.sent_count,
                "delivered_count": bs.delivered_count,
                "failed_count": bs.failed_count,
                "status": bs.status,
                "started_at": bs.started_at.isoformat() if bs.started_at else None,
                "completed_at": bs.completed_at.isoformat() if bs.completed_at else None,
                "created_at": bs.created_at.isoformat() if bs.created_at else None,
            }
            for bs in bulk_sends
        ]

    async def update_connection_status(
        self,
        status: str,
        phone_number: Optional[str] = None,
        dealership_id: Optional[UUID] = None,
    ) -> WhatsAppConnection:
        """Update or create connection status record."""
        query = select(WhatsAppConnection)
        if dealership_id:
            query = query.where(WhatsAppConnection.dealership_id == dealership_id)
        else:
            query = query.where(WhatsAppConnection.dealership_id.is_(None))
        
        result = await self.session.execute(query)
        connection = result.scalar_one_or_none()

        now = utc_now()
        
        if connection:
            connection.status = status
            connection.phone_number = phone_number or connection.phone_number
            connection.updated_at = now
            if status == "connected":
                connection.last_connected_at = now
            elif status == "disconnected":
                connection.last_disconnected_at = now
        else:
            connection = WhatsAppConnection(
                id=uuid.uuid4(),
                dealership_id=dealership_id,
                phone_number=phone_number,
                status=status,
                last_connected_at=now if status == "connected" else None,
                created_at=now,
            )
            self.session.add(connection)

        await self.session.flush()
        return connection
