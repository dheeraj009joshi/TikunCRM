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


# ── Program, portal login, BDC coverage ───────────────────────────

from decimal import Decimal

from app.core.security import get_password_hash
from app.core.timezone import utc_now
from app.models.partner_bdc_agent import PartnerBdcAgent
from app.models.partner_portal_user import PartnerPortalUser
from app.models.partner_program import (
    PROGRAM_STATUSES,
    PROGRAM_TYPES,
    PartnerProgram,
)
from app.models.user import User as CrmUser


class PartnerProgramUpsert(BaseModel):
    program_type: str
    status: str = "pending"
    states: List[str] = Field(default_factory=list)
    postal_codes: List[str] = Field(default_factory=list)
    min_credit_score: Optional[int] = None
    max_credit_score: Optional[int] = None
    min_down_payment: Optional[Decimal] = None
    daily_cap: Optional[int] = Field(None, ge=0)
    monthly_cap: Optional[int] = Field(None, ge=0)
    hours: dict = Field(default_factory=dict)
    timezone: str = "America/New_York"
    priority_weight: int = 0


class PartnerProgramResponse(PartnerProgramUpsert):
    id: UUID
    partner_store_id: UUID

    model_config = {"from_attributes": True}


class PortalUserCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)


class PortalUserResponse(BaseModel):
    id: UUID
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


class BdcAgentAssignment(BaseModel):
    user_id: UUID
    max_open_leads: int = Field(15, ge=1, le=200)


class BdcAgentResponse(BaseModel):
    user_id: UUID
    max_open_leads: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None


def _clean_str_list(values: List[str]) -> list:
    cleaned = []
    seen = set()
    for value in values or []:
        item = str(value).strip()
        if not item:
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)
    return cleaned


async def _get_store_or_404(db: AsyncSession, store_id: UUID) -> PartnerStore:
    store = await db.get(PartnerStore, store_id)
    if store is None:
        raise HTTPException(status_code=404, detail="Partner store not found")
    return store


@router.get("/{store_id}/program", response_model=Optional[PartnerProgramResponse])
async def get_program(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.MANAGE_PARTNER_STORES)),
) -> Any:
    await _get_store_or_404(db, store_id)
    program = (
        await db.execute(
            select(PartnerProgram).where(PartnerProgram.partner_store_id == store_id)
        )
    ).scalar_one_or_none()
    return program


@router.put("/{store_id}/program", response_model=PartnerProgramResponse)
async def upsert_program(
    store_id: UUID,
    body: PartnerProgramUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.MANAGE_PARTNER_STORES)),
) -> Any:
    await _get_store_or_404(db, store_id)
    if body.program_type not in PROGRAM_TYPES:
        raise HTTPException(status_code=400, detail="program_type must be leads_only or full_bdc")
    if body.status not in PROGRAM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid program status")
    program = (
        await db.execute(
            select(PartnerProgram).where(PartnerProgram.partner_store_id == store_id)
        )
    ).scalar_one_or_none()
    payload = body.model_dump()
    payload["states"] = _clean_str_list(body.states)
    payload["postal_codes"] = _clean_str_list(body.postal_codes)
    if program is None:
        program = PartnerProgram(partner_store_id=store_id, **payload)
        db.add(program)
    else:
        for field, value in payload.items():
            setattr(program, field, value)
        program.updated_at = utc_now()
    await db.commit()
    await db.refresh(program)
    logger.info("Partner program saved for store %s by %s", store_id, current_user.email)
    return program


@router.get("/{store_id}/portal-users", response_model=List[PortalUserResponse])
async def list_portal_users(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.MANAGE_PARTNER_STORES)),
) -> Any:
    await _get_store_or_404(db, store_id)
    rows = (
        await db.execute(
            select(PartnerPortalUser)
            .where(PartnerPortalUser.partner_store_id == store_id)
            .order_by(PartnerPortalUser.email)
        )
    ).scalars().all()
    return list(rows)


@router.post("/{store_id}/portal-users", response_model=PortalUserResponse, status_code=status.HTTP_201_CREATED)
async def create_portal_user(
    store_id: UUID,
    body: PortalUserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.MANAGE_PARTNER_STORES)),
) -> Any:
    await _get_store_or_404(db, store_id)
    email = body.email.strip().lower()
    existing = (
        await db.execute(select(PartnerPortalUser).where(PartnerPortalUser.email == email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=400, detail="That portal email is already in use")
    portal_user = PartnerPortalUser(
        partner_store_id=store_id,
        email=email,
        password_hash=get_password_hash(body.password),
        first_name=(body.first_name or "").strip() or None,
        last_name=(body.last_name or "").strip() or None,
        is_active=True,
    )
    db.add(portal_user)
    await db.commit()
    await db.refresh(portal_user)
    logger.info("Portal user %s created for store %s by %s", email, store_id, current_user.email)
    return portal_user


@router.get("/{store_id}/bdc-agents", response_model=List[BdcAgentResponse])
async def list_bdc_agents(
    store_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.MANAGE_PARTNER_STORES)),
) -> Any:
    await _get_store_or_404(db, store_id)
    rows = (
        await db.execute(
            select(PartnerBdcAgent, CrmUser)
            .join(CrmUser, CrmUser.id == PartnerBdcAgent.user_id)
            .where(PartnerBdcAgent.partner_store_id == store_id)
            .order_by(CrmUser.first_name)
        )
    ).all()
    return [
        BdcAgentResponse(
            user_id=agent.user_id,
            max_open_leads=agent.max_open_leads,
            first_name=user.first_name,
            last_name=user.last_name,
            email=user.email,
        )
        for agent, user in rows
    ]


@router.put("/{store_id}/bdc-agents", response_model=List[BdcAgentResponse])
async def replace_bdc_agents(
    store_id: UUID,
    body: List[BdcAgentAssignment],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.MANAGE_PARTNER_STORES)),
) -> Any:
    await _get_store_or_404(db, store_id)
    seen = set()
    for item in body:
        if item.user_id in seen:
            raise HTTPException(status_code=400, detail="Duplicate BDC agent")
        seen.add(item.user_id)
        user = await db.get(CrmUser, item.user_id)
        role = user.role.value if user and hasattr(user.role, "value") else None
        if user is None or role != "bdc":
            raise HTTPException(status_code=400, detail="Each agent must be an active BDC user")
    existing = (
        await db.execute(
            select(PartnerBdcAgent).where(PartnerBdcAgent.partner_store_id == store_id)
        )
    ).scalars().all()
    for row in existing:
        await db.delete(row)
    await db.flush()
    for item in body:
        db.add(
            PartnerBdcAgent(
                user_id=item.user_id,
                partner_store_id=store_id,
                max_open_leads=item.max_open_leads,
            )
        )
    await db.commit()
    return await list_bdc_agents(store_id, db, current_user)
