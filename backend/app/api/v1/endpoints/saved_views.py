"""
Saved Views Endpoints — user-defined filter/column/sort presets for list screens.
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.database import get_db
from app.models.saved_view import SavedView
from app.models.user import User
from app.schemas.saved_view import SavedViewCreate, SavedViewResponse, SavedViewUpdate

router = APIRouter()


@router.get("/", response_model=List[SavedViewResponse])
async def list_saved_views(
    entity_type: Optional[str] = Query(None, description="Filter by screen, e.g. 'leads'"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """List the current user's saved views."""
    q = select(SavedView).where(SavedView.user_id == current_user.id)
    if entity_type:
        q = q.where(SavedView.entity_type == entity_type)
    q = q.order_by(SavedView.created_at.asc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/", response_model=SavedViewResponse, status_code=201)
async def create_saved_view(
    view_in: SavedViewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create a saved view for the current user."""
    if view_in.is_default:
        await db.execute(
            update(SavedView)
            .where(
                SavedView.user_id == current_user.id,
                SavedView.entity_type == view_in.entity_type,
            )
            .values(is_default=False)
        )
    view = SavedView(
        user_id=current_user.id,
        name=view_in.name,
        entity_type=view_in.entity_type,
        filters=view_in.filters,
        columns=view_in.columns,
        sort=view_in.sort,
        is_default=view_in.is_default,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view


@router.patch("/{view_id}", response_model=SavedViewResponse)
async def update_saved_view(
    view_id: UUID,
    view_in: SavedViewUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Update one of the current user's saved views."""
    result = await db.execute(
        select(SavedView).where(SavedView.id == view_id, SavedView.user_id == current_user.id)
    )
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="Saved view not found")

    data = view_in.model_dump(exclude_unset=True)
    if data.get("is_default"):
        await db.execute(
            update(SavedView)
            .where(
                SavedView.user_id == current_user.id,
                SavedView.entity_type == view.entity_type,
                SavedView.id != view.id,
            )
            .values(is_default=False)
        )
    for key, value in data.items():
        setattr(view, key, value)
    await db.commit()
    await db.refresh(view)
    return view


@router.delete("/{view_id}", status_code=204)
async def delete_saved_view(
    view_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> None:
    """Delete one of the current user's saved views."""
    result = await db.execute(
        select(SavedView).where(SavedView.id == view_id, SavedView.user_id == current_user.id)
    )
    view = result.scalar_one_or_none()
    if not view:
        raise HTTPException(status_code=404, detail="Saved view not found")
    await db.delete(view)
    await db.commit()
