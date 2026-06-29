"""
Guest profile endpoints (authenticated). Public scan endpoint lives in public.py.
"""
import logging
from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.access_scope import user_can_access_dealership
from app.core.config import settings
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.guest import Guest, GuestStatus
from app.models.user import User
from app.schemas.guest import (
    GuestCreate,
    GuestDocument,
    GuestResponse,
    GuestShareResponse,
    GuestUpdate,
)
from app.services.guest_service import GuestService

logger = logging.getLogger(__name__)

router = APIRouter()


async def _get_guest_or_404(db: AsyncSession, guest_id: UUID) -> Guest:
    res = await db.execute(select(Guest).where(Guest.id == guest_id))
    guest = res.scalar_one_or_none()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.post("", response_model=GuestResponse)
async def create_guest(
    body: GuestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create a guest profile, auto-filling from the lead/customer when available.

    Idempotent per appointment: if a guest already exists for the given
    appointment, the existing one is returned (so reopening shows the same QR)."""
    data = body.model_dump(exclude_unset=True)

    if data.get("appointment_id"):
        existing = await db.execute(
            select(Guest).where(Guest.appointment_id == data["appointment_id"])
        )
        existing_guest = existing.scalar_one_or_none()
        if existing_guest:
            return existing_guest

    guest = Guest(
        created_by=current_user.id,
        dealership_id=data.get("dealership_id") or current_user.dealership_id,
        appointment_id=data.get("appointment_id"),
        lead_id=data.get("lead_id"),
        customer_id=data.get("customer_id"),
        full_name=data.get("full_name"),
        phone=data.get("phone"),
        email=data.get("email"),
        address=data.get("address"),
        city=data.get("city"),
        state=data.get("state"),
        postal_code=data.get("postal_code"),
        down_payment=data.get("down_payment"),
        vehicle_of_interest=data.get("vehicle_of_interest"),
        trade_in=data.get("trade_in"),
        notes=data.get("notes"),
        status=GuestStatus.DRAFT.value,
    )

    if guest.lead_id:
        await GuestService.autofill_from_lead(db, guest, guest.lead_id)

    # BDC access check on the resolved dealership
    if current_user.role == UserRole.BDC and guest.dealership_id:
        if not await user_can_access_dealership(db, current_user, guest.dealership_id):
            raise HTTPException(status_code=403, detail="Not authorized for this dealership")

    db.add(guest)
    await db.commit()
    await db.refresh(guest)
    return guest


@router.get("/{guest_id}", response_model=GuestResponse)
async def get_guest(
    guest_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    return await _get_guest_or_404(db, guest_id)


@router.get("/{guest_id}/documents", response_model=List[GuestDocument])
async def get_guest_documents(
    guest_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    guest = await _get_guest_or_404(db, guest_id)
    if not guest.lead_id:
        return []
    return await GuestService.list_lead_documents(db, guest.lead_id)


@router.put("/{guest_id}", response_model=GuestResponse)
async def update_guest(
    guest_id: UUID,
    body: GuestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    guest = await _get_guest_or_404(db, guest_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(guest, field, value)
    await db.commit()
    await db.refresh(guest)
    return guest


@router.post("/{guest_id}/share", response_model=GuestShareResponse)
async def share_guest(
    guest_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Generate (or rotate) the opaque share token and return the public URL."""
    guest = await _get_guest_or_404(db, guest_id)
    guest.share_token = GuestService.generate_token()
    guest.share_revoked = False
    if guest.status == GuestStatus.DRAFT.value:
        guest.status = GuestStatus.READY.value
    await db.commit()
    await db.refresh(guest)
    share_url = f"{settings.frontend_url.rstrip('/')}/g/{guest.share_token}"
    return GuestShareResponse(share_token=guest.share_token, share_url=share_url)


@router.post("/{guest_id}/revoke-share", response_model=GuestResponse)
async def revoke_guest_share(
    guest_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    guest = await _get_guest_or_404(db, guest_id)
    guest.share_revoked = True
    await db.commit()
    await db.refresh(guest)
    return guest
