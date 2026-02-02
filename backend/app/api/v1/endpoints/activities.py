"""
Activity Endpoints
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.activity import Activity, ActivityType
from app.models.user import User
from app.schemas.activity import ActivityListResponse, ActivityWithUser

router = APIRouter()


@router.get("/", response_model=ActivityListResponse)
async def list_activities(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    lead_id: Optional[UUID] = None,
    user_id: Optional[UUID] = None,
    type: Optional[ActivityType] = None
) -> Any:
    """
    List activity logs with filtering and pagination.
    """
    query = select(Activity)
    
    # RBAC and Isolation
    if current_user.role == UserRole.SALESPERSON:
        # Salesperson only sees activities they performed or related to their leads
        query = query.where(Activity.user_id == current_user.id)
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        query = query.where(Activity.dealership_id == current_user.dealership_id)
    
    # Filters
    if lead_id:
        query = query.where(Activity.lead_id == lead_id)
    if user_id:
        query = query.where(Activity.user_id == user_id)
    if type:
        query = query.where(Activity.type == type)
        
    # Pagination
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    query = query.order_by(desc(Activity.created_at))
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    activities = result.scalars().all()
    
    # Fetch user info for each activity
    items: List[dict] = []
    for activity in activities:
        activity_data = {
            "id": activity.id,
            "type": activity.type,
            "description": activity.description,
            "user_id": activity.user_id,
            "lead_id": activity.lead_id,
            "dealership_id": activity.dealership_id,
            "meta_data": activity.meta_data,
            "created_at": activity.created_at,
            "user": None
        }
        
        # Fetch user info if user_id exists
        if activity.user_id:
            user_result = await db.execute(select(User).where(User.id == activity.user_id))
            user = user_result.scalar_one_or_none()
            if user:
                activity_data["user"] = {
                    "id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "role": user.role,
                    "is_active": user.is_active,
                    "dealership_id": user.dealership_id
                }
        
        items.append(activity_data)
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size
    }


@router.get("/lead/{lead_id}", response_model=ActivityListResponse)
async def get_lead_timeline(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100)
) -> Any:
    """
    Convenience endpoint for a lead's complete activity timeline.
    """
    return await list_activities(
        db=db,
        current_user=current_user,
        page=page,
        page_size=page_size,
        lead_id=lead_id
    )
