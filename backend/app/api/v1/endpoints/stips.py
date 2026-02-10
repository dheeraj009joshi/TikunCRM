"""
Stips Endpoints — categories CRUD (admin). Lead documents are under leads router.
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.schemas.stips import (
    StipsCategoryCreate,
    StipsCategoryReorder,
    StipsCategoryResponse,
    StipsCategoryUpdate,
)
from app.services.stips_service import StipsCategoryService

router = APIRouter()


class StipsStatusResponse(BaseModel):
    configured: bool


@router.get("/status", response_model=StipsStatusResponse)
async def stips_status(
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Whether Stips storage (Azure) is configured; frontend uses this to show/hide upload."""
    return StipsStatusResponse(configured=settings.is_azure_stips_configured)


@router.get("/categories", response_model=List[StipsCategoryResponse])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    dealership_id: Optional[UUID] = Query(None, description="Filter by dealership"),
) -> Any:
    """List Stips categories (optionally by dealership), ordered by display_order."""
    did = dealership_id or current_user.dealership_id
    categories = await StipsCategoryService.list_categories(db, did)
    return categories


@router.post("/categories", response_model=StipsCategoryResponse)
async def create_category(
    body: StipsCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create a Stips category (admin only)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage Stips categories")
    category = await StipsCategoryService.create_category(
        db,
        name=body.name,
        display_order=body.display_order,
        scope=body.scope,
        dealership_id=body.dealership_id or current_user.dealership_id,
    )
    await db.commit()
    await db.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=StipsCategoryResponse)
async def update_category(
    category_id: UUID,
    body: StipsCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Update a Stips category (admin only)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage Stips categories")
    category = await StipsCategoryService.get_category(db, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    await StipsCategoryService.update_category(db, category, body.model_dump(exclude_unset=True))
    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Delete a Stips category only if no documents reference it (admin only)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage Stips categories")
    success, message = await StipsCategoryService.delete_category(db, category_id)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    await db.commit()
    return {"message": "Category deleted"}


@router.post("/categories/reorder")
async def reorder_categories(
    body: StipsCategoryReorder,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Reorder Stips categories (admin only)."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can manage Stips categories")
    await StipsCategoryService.reorder_categories(db, body.ordered_ids)
    await db.commit()
    return {"message": "Categories reordered"}
