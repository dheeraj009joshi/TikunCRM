"""
API endpoints for Notifications
"""
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.notification import Notification, NotificationType
from app.schemas.notification import (
    NotificationResponse,
    NotificationListResponse,
    NotificationMarkReadRequest,
    NotificationStats,
)

router = APIRouter()


@router.get("/", response_model=NotificationListResponse)
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    unread_only: bool = Query(False, description="Only show unread notifications"),
    notification_type: Optional[str] = Query(None, description="Filter by notification type (e.g. mention, MENTION)"),
) -> Any:
    """
    Get list of notifications for the current user.
    Sorted by creation date (newest first).
    """
    # Base query
    query = select(Notification).where(Notification.user_id == current_user.id)
    
    # Apply filters
    if unread_only:
        query = query.where(Notification.is_read == False)
    
    # Normalize type filter (API may receive lowercase; DB stores uppercase)
    type_enum = None
    if notification_type:
        try:
            type_enum = NotificationType(notification_type.upper())
        except ValueError:
            pass
    if type_enum is not None:
        query = query.where(Notification.type == type_enum)
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Get unread count
    unread_query = select(func.count()).where(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    )
    unread_result = await db.execute(unread_query)
    unread_count = unread_result.scalar() or 0
    
    # Apply pagination and ordering
    query = query.order_by(Notification.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    notifications = result.scalars().all()
    
    return NotificationListResponse(
        items=notifications,
        total=total,
        unread_count=unread_count
    )


@router.get("/stats", response_model=NotificationStats)
async def get_notification_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Get notification statistics for the current user.
    Useful for displaying badge count in the UI.
    """
    # Total count
    total_query = select(func.count()).where(Notification.user_id == current_user.id)
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    # Unread count
    unread_query = select(func.count()).where(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    )
    unread_result = await db.execute(unread_query)
    unread = unread_result.scalar() or 0
    
    # Count by type (for unread only)
    type_query = (
        select(Notification.type, func.count())
        .where(
            Notification.user_id == current_user.id,
            Notification.is_read == False
        )
        .group_by(Notification.type)
    )
    type_result = await db.execute(type_query)
    by_type = {row[0].value: row[1] for row in type_result.all()}
    
    return NotificationStats(
        total=total,
        unread=unread,
        by_type=by_type
    )


@router.get("/{notification_id}", response_model=NotificationResponse)
async def get_notification(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Get a specific notification.
    """
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id
        )
    )
    notification = result.scalar_one_or_none()
    
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    
    return notification


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Mark a specific notification as read.
    """
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id
        )
    )
    notification = result.scalar_one_or_none()
    
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = utc_now()
        await db.commit()
        await db.refresh(notification)
    
    return notification


@router.post("/mark-read", status_code=status.HTTP_200_OK)
async def mark_notifications_read(
    request: NotificationMarkReadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> dict:
    """
    Mark multiple notifications as read.
    """
    now = utc_now()
    
    stmt = (
        update(Notification)
        .where(
            Notification.id.in_(request.notification_ids),
            Notification.user_id == current_user.id,
            Notification.is_read == False
        )
        .values(is_read=True, read_at=now)
    )
    
    result = await db.execute(stmt)
    await db.commit()
    
    return {"marked_count": result.rowcount}


@router.post("/mark-all-read", status_code=status.HTTP_200_OK)
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> dict:
    """
    Mark all notifications as read for the current user.
    """
    now = utc_now()
    
    stmt = (
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.is_read == False
        )
        .values(is_read=True, read_at=now)
    )
    
    result = await db.execute(stmt)
    await db.commit()
    
    return {"marked_count": result.rowcount}


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> None:
    """
    Delete a specific notification.
    """
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id
        )
    )
    notification = result.scalar_one_or_none()
    
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    
    await db.delete(notification)
    await db.commit()
