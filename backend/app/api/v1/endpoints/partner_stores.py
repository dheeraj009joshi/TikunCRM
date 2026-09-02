"""
Partner Store Endpoints — CRUD for external dealer partners.
"""
import logging
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission
from app.db.database import get_db
from app.models.partner_store import PartnerStore
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────

class PartnerStoreCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    brand: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = None
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    country: Optional[str] = Field("US", max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    website: Optional[str] = Field(None, max_length=255)
    contact_person: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class PartnerStoreUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    brand: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = None
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    country: Optional[str] = Field(None, max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    website: Optional[str] = Field(None, max_length=255)
    contact_person: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class PartnerStoreResponse(BaseModel):
    id: UUID
    name: str
    brand: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    contact_person: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool
    created_at: Any
    updated_at: Any

    model_config = {"from_attributes": True}


class PartnerStoreListResponse(BaseModel):
    items: List[PartnerStoreResponse]
    total: int


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("/", response_model=PartnerStoreListResponse)
async def list_partner_stores(
    brand: Optional[str] = Query(None),
    active_only: bool = Query(True),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """List all partner stores, optionally filtered by brand."""
    query = select(PartnerStore)

    if active_only:
        query = query.where(PartnerStore.is_active.is_(True))
    if brand:
        query = query.where(func.lower(PartnerStore.brand) == brand.lower())
    if search:
        pattern = f"%{search}%"
        query = query.where(
            func.lower(PartnerStore.name).like(pattern.lower())
            | func.lower(PartnerStore.brand).like(pattern.lower())
            | func.lower(PartnerStore.city).like(pattern.lower())
        )

    query = query.order_by(PartnerStore.name)
    result = await db.execute(query)
    stores = list(result.scalars().all())
    return PartnerStoreListResponse(items=stores, total=len(stores))


@router.get("/brands", response_model=List[str])
async def list_brands(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Return distinct vehicle brands across active partner stores."""
    result = await db.execute(
        select(PartnerStore.brand)
        .where(PartnerStore.is_active.is_(True), PartnerStore.brand.isnot(None))
        .distinct()
        .order_by(PartnerStore.brand)
    )
    return [row[0] for row in result.all()]


@router.get("/{store_id}", response_model=PartnerStoreResponse)
async def get_partner_store(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Get a single partner store by ID."""
    result = await db.execute(
        select(PartnerStore).where(PartnerStore.id == store_id)
    )
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Partner store not found")
    return store


@router.post("/", response_model=PartnerStoreResponse, status_code=status.HTTP_201_CREATED)
async def create_partner_store(
    body: PartnerStoreCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        deps.require_permission(Permission.MANAGE_PARTNER_STORES)
    ),
) -> Any:
    """Create a new partner store (admin/manager only)."""
    store = PartnerStore(**body.model_dump())
    db.add(store)
    await db.commit()
    await db.refresh(store)
    logger.info(f"Partner store created: {store.name} by {current_user.email}")
    return store


@router.put("/{store_id}", response_model=PartnerStoreResponse)
async def update_partner_store(
    store_id: UUID,
    body: PartnerStoreUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        deps.require_permission(Permission.MANAGE_PARTNER_STORES)
    ),
) -> Any:
    """Update a partner store (admin/manager only)."""
    result = await db.execute(
        select(PartnerStore).where(PartnerStore.id == store_id)
    )
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Partner store not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(store, field, value)

    await db.commit()
    await db.refresh(store)
    logger.info(f"Partner store updated: {store.name} by {current_user.email}")
    return store


@router.delete("/{store_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_partner_store(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        deps.require_permission(Permission.MANAGE_PARTNER_STORES)
    ),
) -> None:
    """Soft-delete a partner store (set is_active=false)."""
    result = await db.execute(
        select(PartnerStore).where(PartnerStore.id == store_id)
    )
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Partner store not found")

    store.is_active = False
    await db.commit()
    logger.info(f"Partner store deactivated: {store.name} by {current_user.email}")
