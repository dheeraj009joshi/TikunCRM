"""BDC desk for full-BDC partner deliveries."""
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.appointment import Appointment, AppointmentStatus, AppointmentType
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_delivery import BDC_DESK_STATUSES, LeadDelivery
from app.models.partner_bdc_agent import PartnerBdcAgent
from app.models.partner_program import PROGRAM_FULL_BDC
from app.models.partner_store import PartnerStore
from app.models.user import User
from app.services.partner_routing_service import mark_delivery_appointment_set

router = APIRouter()

_DESK_ROLES = {
    UserRole.BDC,
    UserRole.SUPER_ADMIN,
    UserRole.DEALERSHIP_ADMIN,
    UserRole.DEALERSHIP_OWNER,
}


class DeskItem(BaseModel):
    id: UUID
    lead_id: UUID
    customer_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    brand: str
    partner_store_id: UUID
    partner_store_name: Optional[str] = None
    status: str
    bdc_agent_id: Optional[UUID] = None
    delivered_at: Any
    note: Optional[str] = None


class DeskStatusUpdate(BaseModel):
    status: str
    note: Optional[str] = Field(None, max_length=2000)


class DeskBookAppointment(BaseModel):
    scheduled_at: datetime
    duration_minutes: int = Field(60, ge=15, le=240)
    note: Optional[str] = Field(None, max_length=2000)


def _require_desk(user: User) -> None:
    if user.role not in _DESK_ROLES:
        raise HTTPException(status_code=403, detail="BDC desk is not available for this account")


async def _covered_store_ids(db: AsyncSession, user: User) -> Optional[list]:
    """None means every full-BDC store (managers). A list is the agent's stores."""
    if user.role != UserRole.BDC:
        return None
    rows = (
        await db.execute(
            select(PartnerBdcAgent.partner_store_id).where(PartnerBdcAgent.user_id == user.id)
        )
    ).scalars().all()
    return list(rows)


async def _load_item(db: AsyncSession, delivery: LeadDelivery) -> DeskItem:
    customer = await db.get(Customer, delivery.customer_id)
    store = await db.get(PartnerStore, delivery.partner_store_id)
    name = "Customer"
    phone = None
    email = None
    if customer is not None:
        name = f"{customer.first_name or ''} {customer.last_name or ''}".strip() or "Customer"
        phone = customer.phone
        email = customer.email
    return DeskItem(
        id=delivery.id,
        lead_id=delivery.lead_id,
        customer_name=name,
        phone=phone,
        email=email,
        brand=delivery.brand,
        partner_store_id=delivery.partner_store_id,
        partner_store_name=store.name if store else None,
        status=delivery.status,
        bdc_agent_id=delivery.bdc_agent_id,
        delivered_at=delivery.delivered_at,
        note=delivery.note,
    )


async def _get_visible_delivery(db: AsyncSession, user: User, delivery_id: UUID) -> LeadDelivery:
    delivery = await db.get(LeadDelivery, delivery_id)
    if delivery is None or delivery.program_type != PROGRAM_FULL_BDC:
        raise HTTPException(status_code=404, detail="Delivery not found")
    store_ids = await _covered_store_ids(db, user)
    if store_ids is not None and delivery.partner_store_id not in store_ids:
        raise HTTPException(status_code=403, detail="This store is not on your desk")
    if user.role == UserRole.BDC and delivery.bdc_agent_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="This lead is assigned to another agent")
    return delivery


@router.get("/queue", response_model=List[DeskItem])
async def desk_queue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_desk(current_user)
    query = select(LeadDelivery).where(
        LeadDelivery.program_type == PROGRAM_FULL_BDC,
        LeadDelivery.status.notin_(["dead", "returned", "sold"]),
    )
    store_ids = await _covered_store_ids(db, current_user)
    if store_ids is not None:
        if not store_ids:
            return []
        query = query.where(
            LeadDelivery.partner_store_id.in_(store_ids),
            or_(
                LeadDelivery.bdc_agent_id == current_user.id,
                LeadDelivery.bdc_agent_id.is_(None),
            ),
        )
    rows = list(
        (await db.execute(query.order_by(LeadDelivery.delivered_at.asc()).limit(200))).scalars().all()
    )
    return [await _load_item(db, row) for row in rows]


@router.post("/{delivery_id}/status", response_model=DeskItem)
async def update_desk_status(
    delivery_id: UUID,
    body: DeskStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_desk(current_user)
    if body.status not in BDC_DESK_STATUSES:
        raise HTTPException(status_code=400, detail="Status is not a BDC desk status")
    delivery = await _get_visible_delivery(db, current_user, delivery_id)
    if delivery.bdc_agent_id is None and current_user.role == UserRole.BDC:
        delivery.bdc_agent_id = current_user.id
    delivery.status = body.status
    if body.note is not None:
        delivery.note = body.note
    delivery.updated_at = utc_now()
    await db.commit()
    await db.refresh(delivery)
    return await _load_item(db, delivery)


@router.post("/{delivery_id}/appointment", response_model=DeskItem)
async def book_desk_appointment(
    delivery_id: UUID,
    body: DeskBookAppointment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_desk(current_user)
    delivery = await _get_visible_delivery(db, current_user, delivery_id)
    if delivery.status in ("dead", "returned", "sold"):
        raise HTTPException(status_code=400, detail="This delivery is closed")
    lead = await db.get(Lead, delivery.lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if delivery.bdc_agent_id is None:
        delivery.bdc_agent_id = current_user.id
    appointment = Appointment(
        title=f"Showroom visit — {delivery.brand}",
        description=body.note,
        appointment_type=AppointmentType.IN_PERSON,
        scheduled_at=body.scheduled_at,
        duration_minutes=body.duration_minutes,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        partner_store_id=delivery.partner_store_id,
        scheduled_by=current_user.id,
        assigned_to=current_user.id,
        status=AppointmentStatus.SCHEDULED,
    )
    db.add(appointment)
    await db.flush()
    await mark_delivery_appointment_set(
        db, delivery.lead_id, delivery.partner_store_id, body.scheduled_at
    )
    if body.note:
        delivery.note = body.note
    await db.commit()
    await db.refresh(delivery)
    return await _load_item(db, delivery)
