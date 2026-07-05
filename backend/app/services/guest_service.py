"""
Guest profile helpers: auto-fill from lead/customer and share-token generation.
"""
import secrets
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guest import Guest, GuestStatus
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.lead_stip_document import LeadStipDocument
from app.models.stips_category import StipsCategory


class GuestService:
    @staticmethod
    def generate_token() -> str:
        """URL-safe, non-guessable opaque token."""
        return secrets.token_urlsafe(32)

    @staticmethod
    async def get_by_lead_id(db: AsyncSession, lead_id: UUID) -> Optional[Guest]:
        """Return the guest profile for a lead, if one exists."""
        res = await db.execute(
            select(Guest)
            .where(Guest.lead_id == lead_id)
            .order_by(Guest.created_at.asc())
            .limit(1)
        )
        return res.scalar_one_or_none()

    @staticmethod
    async def get_by_appointment_id(db: AsyncSession, appointment_id: UUID) -> Optional[Guest]:
        res = await db.execute(select(Guest).where(Guest.appointment_id == appointment_id))
        return res.scalar_one_or_none()

    @staticmethod
    def ensure_share_token(guest: Guest) -> None:
        """Assign a permanent share token the first time a guest profile is created."""
        if not guest.share_token:
            guest.share_token = GuestService.generate_token()
            guest.share_revoked = False
            if guest.status == GuestStatus.DRAFT.value:
                guest.status = GuestStatus.READY.value

    @staticmethod
    async def ensure_for_lead(
        db: AsyncSession,
        lead_id: UUID,
        *,
        created_by: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        appointment_id: Optional[UUID] = None,
    ) -> Guest:
        """Return the existing guest for this lead, or create one with a static QR token."""
        existing = await GuestService.get_by_lead_id(db, lead_id)
        if existing:
            if appointment_id and not existing.appointment_id:
                existing.appointment_id = appointment_id
            # Keep guest tied to the lead's customer so trust criteria use the right person
            lead_res = await db.execute(select(Lead).where(Lead.id == lead_id))
            lead = lead_res.scalar_one_or_none()
            if lead and lead.customer_id and existing.customer_id != lead.customer_id:
                existing.customer_id = lead.customer_id
            GuestService.ensure_share_token(existing)
            return existing

        guest = Guest(
            lead_id=lead_id,
            created_by=created_by,
            dealership_id=dealership_id,
            appointment_id=appointment_id,
            status=GuestStatus.READY.value,
        )
        GuestService.ensure_share_token(guest)
        await GuestService.autofill_from_lead(db, guest, lead_id)
        db.add(guest)
        await db.flush()
        return guest

    @staticmethod
    async def autofill_from_lead(db: AsyncSession, guest: Guest, lead_id: UUID) -> None:
        """Populate empty guest fields from a lead and its primary customer."""
        res = await db.execute(select(Lead).where(Lead.id == lead_id))
        lead = res.scalar_one_or_none()
        if not lead:
            return

        guest.lead_id = lead.id
        if guest.dealership_id is None:
            guest.dealership_id = lead.dealership_id
        if guest.customer_id is None:
            guest.customer_id = lead.customer_id

        cust = lead.customer
        if cust:
            guest.full_name = guest.full_name or cust.full_name
            guest.phone = guest.phone or cust.phone
            guest.email = guest.email or cust.email
            guest.address = guest.address or cust.address
            guest.city = guest.city or cust.city
            guest.state = guest.state or cust.state
            guest.postal_code = guest.postal_code or cust.postal_code

        if guest.down_payment is None:
            dp = lead.down_payment
            if dp is None:
                raw = (lead.meta_data or {}).get("downpayment") or (lead.meta_data or {}).get("down_payment")
                if raw is not None:
                    try:
                        dp = Decimal(str(raw))
                    except Exception:
                        dp = None
            guest.down_payment = dp

        if not guest.vehicle_of_interest:
            guest.vehicle_of_interest = lead.interested_in

    @staticmethod
    async def list_lead_documents(db: AsyncSession, lead_id: UUID) -> List[dict]:
        """Documents on file for the guest, sourced from the linked lead's Stips."""
        res = await db.execute(
            select(LeadStipDocument, StipsCategory)
            .join(StipsCategory, LeadStipDocument.stips_category_id == StipsCategory.id, isouter=True)
            .where(LeadStipDocument.lead_id == lead_id)
            .order_by(LeadStipDocument.uploaded_at.desc())
        )
        documents = []
        for doc, category in res.all():
            documents.append({
                "id": doc.id,
                "category_name": category.name if category else "Document",
                "file_name": doc.file_name,
                "content_type": doc.content_type,
                "uploaded_at": doc.uploaded_at,
            })
        return documents
