"""
LeadStage Endpoints — pipeline configuration.
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.schemas.lead_stage import (
    LeadStageCreate,
    LeadStageReorder,
    LeadStageResponse,
    LeadStageUpdate,
)
from app.services.lead_stage_service import LeadStageService

router = APIRouter()


@router.get("/", response_model=List[LeadStageResponse])
async def list_stages(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    dealership_id: Optional[UUID] = None,
) -> Any:
    """List pipeline stages (per dealership or global)."""
    did = dealership_id or current_user.dealership_id
    stages = await LeadStageService.list_stages(db, did)
    return stages


@router.post("/", response_model=LeadStageResponse)
async def create_stage(
    stage_in: LeadStageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create a custom pipeline stage."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage stages")
    stage = await LeadStageService.create_stage(
        db,
        name=stage_in.name,
        display_name=stage_in.display_name,
        order=stage_in.order,
        color=stage_in.color,
        dealership_id=stage_in.dealership_id or current_user.dealership_id,
        is_terminal=stage_in.is_terminal,
    )
    await db.commit()
    return stage


@router.patch("/{stage_id}", response_model=LeadStageResponse)
async def update_stage(
    stage_id: UUID,
    stage_in: LeadStageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Update a stage (name, color, terminal, active)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage stages")
    stage = await LeadStageService.get_stage(db, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    data = stage_in.model_dump(exclude_unset=True)
    stage = await LeadStageService.update_stage(db, stage, data)
    await db.commit()
    return stage


@router.post("/reorder")
async def reorder_stages(
    reorder_in: LeadStageReorder,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Reorder stages (drag-drop)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage stages")
    await LeadStageService.reorder_stages(db, reorder_in.ordered_ids)
    await db.commit()
    return {"message": "Stages reordered"}


@router.delete("/{stage_id}")
async def delete_stage(
    stage_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Soft-delete a stage (set is_active=False)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage stages")
    stage = await LeadStageService.get_stage(db, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    stage.is_active = False
    await db.commit()
    return {"message": "Stage deactivated"}


@router.post("/seed")
async def seed_stages(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Seed default global stages (admin only, idempotent)."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only super admin can seed stages")
    stages = await LeadStageService.seed_default_stages(db)
    await db.commit()
    return {"message": f"Seeded {len(stages)} stages"}
