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


@router.get("/by-lead/{lead_id}", response_model=GuestResponse)
async def get_guest_by_lead(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Fetch the guest profile linked to a lead (one profile per lead)."""
    guest = await GuestService.get_by_lead_id(db, lead_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found for this lead")
    GuestService.ensure_share_token(guest)
    await db.commit()
    await db.refresh(guest)
    return guest


@router.post("", response_model=GuestResponse)
async def create_guest(
    body: GuestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create or return a guest profile, auto-filling from the lead/customer when available.

    Idempotent per lead and per appointment: reopening always shows the same profile and QR."""
    data = body.model_dump(exclude_unset=True)
    lead_id = data.get("lead_id")
    appointment_id = data.get("appointment_id")

    if appointment_id:
        existing_guest = await GuestService.get_by_appointment_id(db, appointment_id)
        if existing_guest:
            GuestService.ensure_share_token(existing_guest)
            await db.commit()
            await db.refresh(existing_guest)
            return existing_guest

    if lead_id:
        guest = await GuestService.ensure_for_lead(
            db,
            lead_id,
            created_by=current_user.id,
            dealership_id=data.get("dealership_id") or current_user.dealership_id,
            appointment_id=appointment_id,
        )
        if current_user.role == UserRole.BDC and guest.dealership_id:
            if not await user_can_access_dealership(db, current_user, guest.dealership_id):
                raise HTTPException(status_code=403, detail="Not authorized for this dealership")
        await db.commit()
        await db.refresh(guest)
        return guest

    guest = Guest(
        created_by=current_user.id,
        dealership_id=data.get("dealership_id") or current_user.dealership_id,
        appointment_id=appointment_id,
        lead_id=lead_id,
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
        payoff=data.get("payoff"),
        payoff_bank=data.get("payoff_bank"),
        miles=data.get("miles"),
        notes=data.get("notes"),
        status=GuestStatus.READY.value,
    )
    GuestService.ensure_share_token(guest)

    if guest.lead_id:
        await GuestService.autofill_from_lead(db, guest, guest.lead_id)

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
    """Return the public share URL. Reuses the existing token so the QR stays static."""
    guest = await _get_guest_or_404(db, guest_id)
    GuestService.ensure_share_token(guest)
    guest.share_revoked = False
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
