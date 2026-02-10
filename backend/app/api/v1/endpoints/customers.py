"""
Customer Endpoints
"""
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.user import User
from app.schemas.customer import (
    Customer360Response,
    CustomerBrief,
    CustomerCreate,
    CustomerListResponse,
    CustomerResponse,
    CustomerUpdate,
)
from app.services.customer_service import CustomerService

router = APIRouter()


@router.get("/match", response_model=list[CustomerBrief])
async def match_customers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    phone: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    limit: int = Query(5, ge=1, le=10),
) -> Any:
    """Return customers matching phone (normalized) or email (exact). Name is not used. For linking lead to existing customer."""
    customers = await CustomerService.match_customers(
        db, phone=phone, email=email, limit=limit
    )
    return [CustomerBrief.model_validate(c) for c in customers]


@router.get("/", response_model=CustomerListResponse)
async def list_customers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
) -> Any:
    """List / search customers."""
    items, total = await CustomerService.list_customers(db, page, page_size, search)
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/{customer_id}", response_model=Customer360Response)
async def get_customer_360(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Customer 360 view — profile + all leads."""
    customer = await CustomerService.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Fetch all leads for this customer
    leads_result = await db.execute(
        select(Lead)
        .where(Lead.customer_id == customer_id)
        .order_by(Lead.created_at.desc())
    )
    leads = leads_result.scalars().all()

    # Enrich leads (import inline to avoid circular)
    from app.api.v1.endpoints.leads import enrich_leads_with_relations
    enriched_leads = await enrich_leads_with_relations(db, leads)

    active_count = sum(1 for l in leads if l.is_active)

    resp = {
        "id": customer.id,
        "first_name": customer.first_name,
        "last_name": customer.last_name,
        "full_name": customer.full_name,
        "phone": customer.phone,
        "email": customer.email,
        "alternate_phone": customer.alternate_phone,
        "whatsapp": customer.whatsapp,
        "address": customer.address,
        "city": customer.city,
        "state": customer.state,
        "postal_code": customer.postal_code,
        "country": customer.country,
        "date_of_birth": customer.date_of_birth,
        "company": customer.company,
        "job_title": customer.job_title,
        "preferred_contact_method": customer.preferred_contact_method,
        "preferred_contact_time": customer.preferred_contact_time,
        "source_first_touch": customer.source_first_touch,
        "lifetime_value": customer.lifetime_value,
        "meta_data": customer.meta_data or {},
        "created_at": customer.created_at,
        "updated_at": customer.updated_at,
        "leads": enriched_leads,
        "total_leads": len(leads),
        "active_leads": active_count,
    }
    return resp


@router.post("/", response_model=CustomerResponse)
async def create_customer(
    customer_in: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create a customer (with dedup by phone/email)."""
    extra = customer_in.model_dump(exclude={"first_name", "last_name", "phone", "email"}, exclude_unset=True)
    customer, created = await CustomerService.find_or_create(
        db,
        phone=customer_in.phone,
        email=customer_in.email,
        first_name=customer_in.first_name,
        last_name=customer_in.last_name,
        **{k: v for k, v in extra.items() if v is not None},
    )
    await db.commit()
    return customer


@router.patch("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: UUID,
    customer_in: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Update customer contact info."""
    customer = await CustomerService.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    update_data = customer_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if hasattr(customer, field):
            setattr(customer, field, value)
    customer.updated_at = utc_now()
    await db.commit()
    return customer


@router.get("/{customer_id}/leads")
async def get_customer_leads(
    customer_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Get all leads for a customer."""
    customer = await CustomerService.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    leads_result = await db.execute(
        select(Lead).where(Lead.customer_id == customer_id).order_by(Lead.created_at.desc())
    )
    leads = leads_result.scalars().all()

    from app.api.v1.endpoints.leads import enrich_leads_with_relations
    enriched = await enrich_leads_with_relations(db, leads)
    return {"items": enriched, "total": len(enriched)}
