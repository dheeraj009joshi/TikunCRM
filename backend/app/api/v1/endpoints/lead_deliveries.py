"""Staff endpoints for partner deliveries on a lead."""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.access_scope import user_can_access_lead
from app.core.permissions import Permission
from app.db.database import get_db
from app.models.lead import Lead
from app.models.lead_delivery import LeadDelivery
from app.models.partner_store import PartnerStore
from app.models.user import User
from app.services.partner_routing_service import return_delivery, route_lead_safely

router = APIRouter()


class DeliveryResponse(BaseModel):
    id: UUID
    lead_id: UUID
    customer_id: UUID
    brand: str
    partner_store_id: UUID
    partner_store_name: Optional[str] = None
    program_type: str
    status: str
    bdc_agent_id: Optional[UUID] = None
    note: Optional[str] = None
    delivered_at: Any
    updated_at: Any


class ReturnDeliveryRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)


async def _serialize(db: AsyncSession, rows: List[LeadDelivery]) -> List[DeliveryResponse]:
    store_ids = {row.partner_store_id for row in rows}
    names = {}
    if store_ids:
        result = await db.execute(select(PartnerStore).where(PartnerStore.id.in_(store_ids)))
        names = {store.id: store.name for store in result.scalars().all()}
    return [
        DeliveryResponse(
            id=row.id,
            lead_id=row.lead_id,
            customer_id=row.customer_id,
            brand=row.brand,
            partner_store_id=row.partner_store_id,
            partner_store_name=names.get(row.partner_store_id),
            program_type=row.program_type,
            status=row.status,
            bdc_agent_id=row.bdc_agent_id,
            note=row.note,
            delivered_at=row.delivered_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


@router.get("/{lead_id}/deliveries", response_model=List[DeliveryResponse])
async def list_lead_deliveries(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await user_can_access_lead(db, current_user, lead.dealership_id, lead.assigned_to):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = list(
        (
            await db.execute(
                select(LeadDelivery)
                .where(LeadDelivery.lead_id == lead_id)
                .order_by(LeadDelivery.delivered_at.desc())
            )
        ).scalars().all()
    )
    return await _serialize(db, rows)


@router.post("/{lead_id}/route", response_model=List[DeliveryResponse])
async def route_lead_now(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.CONNECT_LEAD_TO_PARTNER)),
) -> Any:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await user_can_access_lead(db, current_user, lead.dealership_id, lead.assigned_to):
        raise HTTPException(status_code=403, detail="Access denied")
    await route_lead_safely(db, lead_id)
    rows = list(
        (
            await db.execute(
                select(LeadDelivery)
                .where(LeadDelivery.lead_id == lead_id)
                .order_by(LeadDelivery.delivered_at.desc())
            )
        ).scalars().all()
    )
    return await _serialize(db, rows)


@router.post("/{lead_id}/deliveries/{delivery_id}/return", response_model=List[DeliveryResponse])
async def return_lead_delivery(
    lead_id: UUID,
    delivery_id: UUID,
    body: ReturnDeliveryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.CONNECT_LEAD_TO_PARTNER)),
) -> Any:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await user_can_access_lead(db, current_user, lead.dealership_id, lead.assigned_to):
        raise HTTPException(status_code=403, detail="Access denied")
    delivery = await db.get(LeadDelivery, delivery_id)
    if delivery is None or delivery.lead_id != lead_id:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if delivery.status in ("dead", "returned"):
        raise HTTPException(status_code=400, detail="Delivery is already closed")
    await return_delivery(db, delivery, body.note)
    await route_lead_safely(db, lead_id)
    rows = list(
        (
            await db.execute(
                select(LeadDelivery)
                .where(LeadDelivery.lead_id == lead_id)
                .order_by(LeadDelivery.delivered_at.desc())
            )
        ).scalars().all()
    )
    return await _serialize(db, rows)
