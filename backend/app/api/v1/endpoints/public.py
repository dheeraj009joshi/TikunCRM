"""
Public, unauthenticated endpoints (no auth dependency).

Currently serves the scanned Guest QR profile.
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.guest import Guest
from app.models.dealership import Dealership
from app.models.appointment import Appointment
from app.schemas.guest import GuestPublicResponse
from app.services.eligibility_service import EligibilityService
from app.services.guest_service import GuestService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/guests/{token}", response_model=GuestPublicResponse)
async def get_public_guest(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Render a guest profile for anyone who scans the QR (validates token)."""
    res = await db.execute(select(Guest).where(Guest.share_token == token))
    guest = res.scalar_one_or_none()
    if not guest or guest.share_revoked:
        raise HTTPException(status_code=404, detail="Guest profile not found")

    dealership_name = None
    if guest.dealership_id:
        dres = await db.execute(select(Dealership).where(Dealership.id == guest.dealership_id))
        dealership = dres.scalar_one_or_none()
        dealership_name = dealership.name if dealership else None

    appointment_at = None
    if guest.appointment_id:
        ares = await db.execute(select(Appointment).where(Appointment.id == guest.appointment_id))
        appt = ares.scalar_one_or_none()
        appointment_at = appt.scheduled_at if appt else None

    eligibility = await EligibilityService.build_assessment_payload(
        db, "guest", guest.id, guest.dealership_id
    )

    documents = []
    if guest.lead_id:
        documents = await GuestService.list_lead_documents(db, guest.lead_id)

    await db.commit()

    return GuestPublicResponse(
        full_name=guest.full_name,
        phone=guest.phone,
        email=guest.email,
        address=guest.address,
        city=guest.city,
        state=guest.state,
        postal_code=guest.postal_code,
        down_payment=guest.down_payment,
        vehicle_of_interest=guest.vehicle_of_interest,
        trade_in=guest.trade_in,
        notes=guest.notes,
        status=guest.status,
        dealership_name=dealership_name,
        appointment_at=appointment_at,
        eligibility=eligibility,
        documents=documents,
    )
