"""Partner portal. Tokens from this login are rejected by CRM endpoints."""
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.security import create_access_token, verify_password
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.appointment import Appointment, AppointmentStatus
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_delivery import LEADS_ONLY_PORTAL_STATUSES, LeadDelivery
from app.models.partner_portal_user import PartnerPortalUser
from app.models.partner_program import PROGRAM_FULL_BDC, PROGRAM_LEADS_ONLY, PartnerProgram
from app.models.partner_store import PartnerStore

auth_router = APIRouter()
router = APIRouter()

_APPOINTMENT_OUTCOMES = {
    "showed": AppointmentStatus.ARRIVED,
    "no_show": AppointmentStatus.NO_SHOW,
    "sold": AppointmentStatus.SOLD,
}
_DELIVERY_FOR_APPOINTMENT = {
    "showed": "showed",
    "no_show": "no_show",
    "sold": "sold",
}


class PartnerLoginRequest(BaseModel):
    email: str
    password: str


class PartnerLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    store_id: UUID
    store_name: str
    program_type: Optional[str] = None


class PartnerMe(BaseModel):
    store_id: UUID
    store_name: str
    brand: Optional[str] = None
    program_type: Optional[str] = None
    email: str


class PortalDelivery(BaseModel):
    id: UUID
    brand: str
    status: str
    customer_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    interested_in: Optional[str] = None
    delivered_at: datetime
    note: Optional[str] = None


class PortalDeliveryUpdate(BaseModel):
    status: str
    note: Optional[str] = Field(None, max_length=2000)


class PortalAppointment(BaseModel):
    id: UUID
    lead_id: Optional[UUID] = None
    title: Optional[str] = None
    scheduled_at: datetime
    status: str
    customer_name: str
    phone: Optional[str] = None
    duration_minutes: int


class PortalAppointmentUpdate(BaseModel):
    outcome: str


async def _store_and_program(db: AsyncSession, store_id: UUID):
    store = await db.get(PartnerStore, store_id)
    program = (
        await db.execute(
            select(PartnerProgram).where(PartnerProgram.partner_store_id == store_id)
        )
    ).scalar_one_or_none()
    return store, program


@auth_router.post("/login", response_model=PartnerLoginResponse)
async def partner_login(
    body: PartnerLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    email = body.email.strip().lower()
    portal_user = (
        await db.execute(select(PartnerPortalUser).where(PartnerPortalUser.email == email))
    ).scalar_one_or_none()
    if portal_user is None or not portal_user.is_active:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not verify_password(body.password, portal_user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    store, program = await _store_and_program(db, portal_user.partner_store_id)
    if store is None or not store.is_active:
        raise HTTPException(status_code=403, detail="This partner store is not active")
    token = create_access_token(
        str(portal_user.id),
        additional_claims={
            "type": "partner",
            "partner_store_id": str(portal_user.partner_store_id),
        },
    )
    return PartnerLoginResponse(
        access_token=token,
        store_id=store.id,
        store_name=store.name,
        program_type=program.program_type if program else None,
    )


@router.get("/me", response_model=PartnerMe)
async def partner_me(
    db: AsyncSession = Depends(get_db),
    partner: PartnerPortalUser = Depends(deps.get_current_partner),
) -> Any:
    store, program = await _store_and_program(db, partner.partner_store_id)
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found")
    return PartnerMe(
        store_id=store.id,
        store_name=store.name,
        brand=store.brand,
        program_type=program.program_type if program else None,
        email=partner.email,
    )


@router.get("/deliveries", response_model=List[PortalDelivery])
async def partner_deliveries(
    db: AsyncSession = Depends(get_db),
    partner: PartnerPortalUser = Depends(deps.get_current_partner),
) -> Any:
    store, program = await _store_and_program(db, partner.partner_store_id)
    if program is None or program.program_type != PROGRAM_LEADS_ONLY:
        return []
    rows = list(
        (
            await db.execute(
                select(LeadDelivery)
                .where(
                    LeadDelivery.partner_store_id == store.id,
                    LeadDelivery.program_type == PROGRAM_LEADS_ONLY,
                )
                .order_by(LeadDelivery.delivered_at.desc())
                .limit(200)
            )
        ).scalars().all()
    )
    items = []
    for row in rows:
        customer = await db.get(Customer, row.customer_id)
        lead = await db.get(Lead, row.lead_id)
        name = "Customer"
        phone = None
        email = None
        interested = None
        if customer is not None:
            name = f"{customer.first_name or ''} {customer.last_name or ''}".strip() or "Customer"
            phone = customer.phone
            email = customer.email
        if lead is not None:
            interested = lead.interested_in
        items.append(
            PortalDelivery(
                id=row.id,
                brand=row.brand,
                status=row.status,
                customer_name=name,
                phone=phone,
                email=email,
                interested_in=interested,
                delivered_at=row.delivered_at,
                note=row.note,
            )
        )
    return items


@router.post("/deliveries/{delivery_id}", response_model=PortalDelivery)
async def update_partner_delivery(
    delivery_id: UUID,
    body: PortalDeliveryUpdate,
    db: AsyncSession = Depends(get_db),
    partner: PartnerPortalUser = Depends(deps.get_current_partner),
) -> Any:
    if body.status not in LEADS_ONLY_PORTAL_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be working, showed, sold, or dead")
    delivery = await db.get(LeadDelivery, delivery_id)
    if delivery is None or delivery.partner_store_id != partner.partner_store_id:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if delivery.program_type != PROGRAM_LEADS_ONLY:
        raise HTTPException(status_code=400, detail="This lead is not a leads-only delivery")
    delivery.status = body.status
    if body.note is not None:
        delivery.note = body.note
    delivery.updated_at = utc_now()
    await db.commit()
    await db.refresh(delivery)
    items = await partner_deliveries(db, partner)
    match = next((item for item in items if item.id == delivery.id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return match


@router.get("/appointments", response_model=List[PortalAppointment])
async def partner_appointments(
    db: AsyncSession = Depends(get_db),
    partner: PartnerPortalUser = Depends(deps.get_current_partner),
) -> Any:
    _store, program = await _store_and_program(db, partner.partner_store_id)
    if program is None or program.program_type != PROGRAM_FULL_BDC:
        return []
    rows = list(
        (
            await db.execute(
                select(Appointment)
                .where(Appointment.partner_store_id == partner.partner_store_id)
                .order_by(Appointment.scheduled_at.desc())
                .limit(200)
            )
        ).scalars().all()
    )
    items = []
    for row in rows:
        customer_name = "Customer"
        phone = None
        if row.lead_id:
            lead = await db.get(Lead, row.lead_id)
            if lead is not None:
                customer = await db.get(Customer, lead.customer_id)
                if customer is not None:
                    customer_name = f"{customer.first_name or ''} {customer.last_name or ''}".strip() or "Customer"
                    phone = customer.phone
        status_value = row.status.value if hasattr(row.status, "value") else str(row.status)
        items.append(
            PortalAppointment(
                id=row.id,
                lead_id=row.lead_id,
                title=row.title,
                scheduled_at=row.scheduled_at,
                status=status_value,
                customer_name=customer_name,
                phone=phone,
                duration_minutes=row.duration_minutes or 60,
            )
        )
    return items


@router.post("/appointments/{appointment_id}", response_model=PortalAppointment)
async def update_partner_appointment(
    appointment_id: UUID,
    body: PortalAppointmentUpdate,
    db: AsyncSession = Depends(get_db),
    partner: PartnerPortalUser = Depends(deps.get_current_partner),
) -> Any:
    if body.outcome not in _APPOINTMENT_OUTCOMES:
        raise HTTPException(status_code=400, detail="Outcome must be showed, no_show, or sold")
    appointment = await db.get(Appointment, appointment_id)
    if appointment is None or appointment.partner_store_id != partner.partner_store_id:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appointment.status = _APPOINTMENT_OUTCOMES[body.outcome]
    if appointment.lead_id:
        delivery = (
            await db.execute(
                select(LeadDelivery).where(
                    LeadDelivery.lead_id == appointment.lead_id,
                    LeadDelivery.partner_store_id == partner.partner_store_id,
                    LeadDelivery.program_type == PROGRAM_FULL_BDC,
                )
            )
        ).scalars().first()
        if delivery is not None and delivery.status not in ("dead", "returned"):
            delivery.status = _DELIVERY_FOR_APPOINTMENT[body.outcome]
            delivery.updated_at = utc_now()
    await db.commit()
    items = await partner_appointments(db, partner)
    match = next((item for item in items if item.id == appointment.id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return match
