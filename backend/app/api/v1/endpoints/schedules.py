"""
Schedule Endpoints
"""
from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.schedule import Schedule
from app.models.user import User
from app.schemas.follow_up import ScheduleResponse, ScheduleCreate

router = APIRouter()


@router.get("/{user_id}", response_model=List[ScheduleResponse])
async def get_user_schedule(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get schedule for a specific user.
    """
    # Permission checks
    if current_user.role == UserRole.SALESPERSON and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    result = await db.execute(select(Schedule).where(Schedule.user_id == user_id))
    return result.scalars().all()


@router.put("/{user_id}", response_model=List[ScheduleResponse])
async def update_user_schedule(
    user_id: UUID,
    schedules_in: List[ScheduleCreate],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update or replace user's availability schedule.
    """
    # RBAC logic: Salesperson can manage own, Dealer Admin can manage team
    if current_user.id != user_id:
        if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
            # Check if user is in same dealership
            user_result = await db.execute(select(User).where(User.id == user_id))
            target_user = user_result.scalar_one_or_none()
            if not target_user or target_user.dealership_id != current_user.dealership_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        elif current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Not authorized")

    # Clear existing schedule
    await db.execute(delete(Schedule).where(Schedule.user_id == user_id))
    
    # Add new schedules
    new_schedules = []
    for sch in schedules_in:
        new_sch = Schedule(
            user_id=user_id,
            day_of_week=sch.get("day_of_week"),
            start_time=sch.get("start_time"),
            end_time=sch.get("end_time"),
            is_available=sch.get("is_available", True)
        )
        db.add(new_sch)
        new_schedules.append(new_sch)
        
    await db.flush()
    return new_schedules
