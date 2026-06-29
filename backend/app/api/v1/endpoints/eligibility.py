"""
Eligibility (Trust) Score endpoints.

- Criteria CRUD + reorder: dealership admin / owner / BDC (super admin any dealership).
- Assessment get / item toggle: any active user (scored on lead, customer, guest).
"""
import logging
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.schemas.eligibility import (
    AssessmentItemUpdate,
    AssessmentResponse,
    CriterionCreate,
    CriterionReorder,
    CriterionResponse,
    CriterionUpdate,
)
from app.services.eligibility_service import EligibilityService

logger = logging.getLogger(__name__)

router = APIRouter()

_CONFIG_ROLES = [
    UserRole.SUPER_ADMIN,
    UserRole.DEALERSHIP_ADMIN,
    UserRole.DEALERSHIP_OWNER,
    UserRole.BDC,
]
_VALID_ENTITY_TYPES = {"lead", "customer", "guest"}


def _require_config_role(user: User) -> None:
    if user.role not in _CONFIG_ROLES:
        raise HTTPException(status_code=403, detail="You cannot manage eligibility criteria")


def _resolve_config_dealership(user: User, dealership_id: Optional[UUID]) -> Optional[UUID]:
    if user.role == UserRole.SUPER_ADMIN:
        return dealership_id
    # Non-super-admins are scoped to their own dealership context.
    return dealership_id or user.dealership_id


# ---------------- Criteria ----------------

@router.get("/criteria", response_model=List[CriterionResponse])
async def list_criteria(
    dealership_id: Optional[UUID] = Query(None),
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    did = dealership_id or current_user.dealership_id
    return await EligibilityService.list_criteria(db, did, active_only=active_only)


@router.post("/criteria", response_model=CriterionResponse)
async def create_criterion(
    body: CriterionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_config_role(current_user)
    data = body.model_dump(exclude_unset=True)
    data["dealership_id"] = _resolve_config_dealership(current_user, data.get("dealership_id"))
    criterion = await EligibilityService.create_criterion(db, data)
    await db.commit()
    await db.refresh(criterion)
    return criterion


@router.put("/criteria/{criterion_id}", response_model=CriterionResponse)
async def update_criterion(
    criterion_id: UUID,
    body: CriterionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_config_role(current_user)
    criterion = await EligibilityService.get_criterion(db, criterion_id)
    if not criterion:
        raise HTTPException(status_code=404, detail="Criterion not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(criterion, field, value)
    await db.commit()
    await db.refresh(criterion)
    return criterion


@router.delete("/criteria/{criterion_id}")
async def delete_criterion(
    criterion_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_config_role(current_user)
    criterion = await EligibilityService.get_criterion(db, criterion_id)
    if not criterion:
        raise HTTPException(status_code=404, detail="Criterion not found")
    await db.delete(criterion)
    await db.commit()
    return {"message": "Criterion deleted"}


@router.put("/criteria/reorder")
async def reorder_criteria(
    body: CriterionReorder,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    _require_config_role(current_user)
    await EligibilityService.reorder(db, body.ordered_ids)
    await db.commit()
    return {"message": "Criteria reordered"}


# ---------------- Assessment ----------------

@router.get("/assessment/{entity_type}/{entity_id}", response_model=AssessmentResponse)
async def get_assessment(
    entity_type: str,
    entity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    if entity_type not in _VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity type")
    payload = await EligibilityService.build_assessment_payload(db, entity_type, entity_id)
    await db.commit()
    return payload


@router.put("/assessment/{entity_type}/{entity_id}/items/{criterion_id}", response_model=AssessmentResponse)
async def set_assessment_item(
    entity_type: str,
    entity_id: UUID,
    criterion_id: UUID,
    body: AssessmentItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    if entity_type not in _VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity type")
    payload = await EligibilityService.set_item(
        db,
        entity_type=entity_type,
        entity_id=entity_id,
        criterion_id=criterion_id,
        is_met=body.is_met,
        value=body.value,
        is_override=body.is_override,
        user_id=current_user.id,
    )
    await db.commit()

    # Best-effort websocket refresh so other lead viewers update live.
    if entity_type == "lead":
        try:
            from app.services.notification_service import emit_lead_updated
            await emit_lead_updated(
                lead_id=str(entity_id),
                dealership_id=str(payload["dealership_id"]) if payload.get("dealership_id") else None,
                update_type="eligibility_updated",
                data={"total_score": float(payload["total_score"])},
                db=db,
            )
        except Exception as e:
            logger.warning(f"Failed to emit eligibility update event: {e}")

    return payload
