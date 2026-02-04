"""
Appointment Endpoints
"""
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, func, and_, or_, literal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.appointment import Appointment, AppointmentStatus, AppointmentType
from app.models.activity import ActivityType
from app.models.notification import NotificationType
from app.services.activity import ActivityService
from app.services.notification_service import NotificationService, send_skate_alert_background
from app.utils.skate_helper import check_skate_condition
from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentUpdate,
    AppointmentComplete,
    AppointmentResponse,
    AppointmentListResponse,
    AppointmentStats,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def get_date_range_for_today():
    """Get start and end of today (UTC)"""
    now = utc_now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    return start_of_day, end_of_day


def get_start_of_week():
    """Get start of current week (Monday, UTC)"""
    now = utc_now()
    start_of_week = now - timedelta(days=now.weekday())
    return start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)


@router.post("", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
async def create_appointment(
    appointment_in: AppointmentCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Create a new appointment.
    """
    is_skate_action = False
    
    # Soft SKATE check: check if this is a SKATE scenario
    if appointment_in.lead_id:
        from app.models.lead import Lead
        lead_result = await db.execute(select(Lead).where(Lead.id == appointment_in.lead_id))
        lead = lead_result.scalar_one_or_none()
        
        if lead:
            skate_info = await check_skate_condition(db, current_user, lead, "book appointment")
            
            if skate_info:
                if not appointment_in.confirm_skate:
                    # Return skate warning for confirmation
                    return JSONResponse(
                        status_code=200,
                        content=skate_info,
                    )
                else:
                    # User confirmed SKATE - proceed but send notifications
                    is_skate_action = True
                    dealership_id = lead.dealership_id or current_user.dealership_id
                    if dealership_id:
                        performer_name = f"{current_user.first_name} {current_user.last_name}"
                        background_tasks.add_task(
                            send_skate_alert_background,
                            lead_id=lead.id,
                            lead_name=skate_info["lead_name"],
                            dealership_id=dealership_id,
                            assigned_to_user_id=lead.assigned_to,
                            assigned_to_name=skate_info["assigned_to_name"],
                            performer_name=performer_name,
                            action="booked an appointment",
                            performer_user_id=current_user.id,
                        )

    # Determine dealership
    dealership_id = current_user.dealership_id

    # Create appointment
    appointment = Appointment(
        title=appointment_in.title,
        description=appointment_in.description,
        appointment_type=appointment_in.appointment_type,
        scheduled_at=appointment_in.scheduled_at,
        duration_minutes=appointment_in.duration_minutes,
        location=appointment_in.location,
        meeting_link=appointment_in.meeting_link,
        lead_id=appointment_in.lead_id,
        dealership_id=dealership_id,
        scheduled_by=current_user.id,
        assigned_to=appointment_in.assigned_to or current_user.id,
        status=AppointmentStatus.SCHEDULED
    )
    
    db.add(appointment)
    await db.flush()
    
    # Log activity if associated with a lead
    if appointment.lead_id:
        appointment_title = appointment.title or "Appointment"
        description = f"Appointment scheduled: {appointment_title}"
        if is_skate_action:
            description = f"[SKATE] {description}"
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.APPOINTMENT_SCHEDULED,
            description=description,
            user_id=current_user.id,
            lead_id=appointment.lead_id,
            dealership_id=dealership_id,
            meta_data={
                "appointment_id": str(appointment.id),
                "appointment_type": appointment.appointment_type.value,
                "scheduled_at": appointment.scheduled_at.isoformat(),
                "performer_name": current_user.full_name,
                "is_skate_action": is_skate_action
            }
        )
    
    # Create notification for assigned user if different from creator
    if appointment.assigned_to and appointment.assigned_to != current_user.id:
        await NotificationService.create_notification(
            db,
            user_id=appointment.assigned_to,
            notification_type=NotificationType.SYSTEM,
            title="New Appointment Assigned",
            message=f"You have been assigned to: {appointment.title or 'Appointment'}",
            link=f"/appointments/{appointment.id}",
            meta_data={
                "appointment_id": str(appointment.id),
                "scheduled_at": appointment.scheduled_at.isoformat()
            }
        )
    
    await db.commit()
    
    # Send SMS confirmation to lead
    if appointment.lead_id:
        from app.models.lead import Lead
        lead_result = await db.execute(select(Lead).where(Lead.id == appointment.lead_id))
        lead = lead_result.scalar_one_or_none()
        
        if lead and lead.phone:
            from app.services.sms_service import sms_service
            
            if sms_service.is_configured:
                try:
                    # Format datetime for SMS
                    scheduled_time = appointment.scheduled_at.strftime("%B %d at %I:%M %p")
                    location_text = f" at {appointment.location}" if appointment.location else ""
                    
                    sms_message = f"Appointment confirmed for {scheduled_time}{location_text}. We'll see you then!"
                    
                    await sms_service.send_sms(lead.phone, sms_message)
                    logger.info(f"Sent appointment confirmation SMS to lead {lead.id}")
                except Exception as e:
                    logger.error(f"Failed to send appointment confirmation SMS: {e}")
    
    # Re-fetch with relationships
    result = await db.execute(
        select(Appointment)
        .options(
            selectinload(Appointment.lead),
            selectinload(Appointment.dealership),
            selectinload(Appointment.scheduled_by_user),
            selectinload(Appointment.assigned_to_user)
        )
        .where(Appointment.id == appointment.id)
    )
    appointment = result.scalar_one()
    
    return appointment


@router.get("", response_model=AppointmentListResponse)
async def list_appointments(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Optional[AppointmentStatus] = Query(None, alias="status"),
    appointment_type: Optional[AppointmentType] = None,
    lead_id: Optional[UUID] = None,
    assigned_to: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    today_only: bool = False,
    upcoming_only: bool = False,
    overdue_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    List appointments with filters.
    - Super Admin: All appointments
    - Dealership Admin/Owner: All dealership appointments
    - Salesperson: Own appointments only
    """
    # Build base query
    query = select(Appointment).options(
        selectinload(Appointment.lead),
        selectinload(Appointment.dealership),
        selectinload(Appointment.scheduled_by_user),
        selectinload(Appointment.assigned_to_user)
    )
    count_query = select(func.count(Appointment.id))
    
    # Apply role-based filtering
    if current_user.role == UserRole.SUPER_ADMIN:
        pass  # No filter
    elif current_user.role in [UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
        query = query.where(Appointment.dealership_id == current_user.dealership_id)
        count_query = count_query.where(Appointment.dealership_id == current_user.dealership_id)
    else:
        # Salesperson - own appointments only
        query = query.where(Appointment.assigned_to == current_user.id)
        count_query = count_query.where(Appointment.assigned_to == current_user.id)
    
    # Apply filters
    if status_filter:
        query = query.where(Appointment.status == status_filter)
        count_query = count_query.where(Appointment.status == status_filter)
    
    if appointment_type:
        query = query.where(Appointment.appointment_type == appointment_type)
        count_query = count_query.where(Appointment.appointment_type == appointment_type)
    
    if lead_id:
        query = query.where(Appointment.lead_id == lead_id)
        count_query = count_query.where(Appointment.lead_id == lead_id)
    
    if assigned_to:
        query = query.where(Appointment.assigned_to == assigned_to)
        count_query = count_query.where(Appointment.assigned_to == assigned_to)
    
    if date_from:
        query = query.where(Appointment.scheduled_at >= date_from)
        count_query = count_query.where(Appointment.scheduled_at >= date_from)
    
    if date_to:
        query = query.where(Appointment.scheduled_at <= date_to)
        count_query = count_query.where(Appointment.scheduled_at <= date_to)
    
    now = utc_now()
    
    if today_only:
        start_of_day, end_of_day = get_date_range_for_today()
        query = query.where(
            and_(
                Appointment.scheduled_at >= start_of_day,
                Appointment.scheduled_at < end_of_day
            )
        )
        count_query = count_query.where(
            and_(
                Appointment.scheduled_at >= start_of_day,
                Appointment.scheduled_at < end_of_day
            )
        )
    
    if upcoming_only:
        query = query.where(
            and_(
                Appointment.scheduled_at > now,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
        count_query = count_query.where(
            and_(
                Appointment.scheduled_at > now,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
    
    if overdue_only:
        query = query.where(
            and_(
                Appointment.scheduled_at < now,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
        count_query = count_query.where(
            and_(
                Appointment.scheduled_at < now,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
    
    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Apply pagination and ordering
    offset = (page - 1) * page_size
    query = query.order_by(Appointment.scheduled_at.asc()).offset(offset).limit(page_size)
    
    # Execute query
    result = await db.execute(query)
    appointments = result.scalars().all()
    
    total_pages = (total + page_size - 1) // page_size
    
    return AppointmentListResponse(
        items=appointments,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.get("/stats", response_model=AppointmentStats)
async def get_appointment_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get appointment statistics for dashboard badges.
    """
    now = utc_now()
    start_of_day, end_of_day = get_date_range_for_today()
    start_of_week = get_start_of_week()
    
    # Base query filter based on role
    if current_user.role == UserRole.SUPER_ADMIN:
        base_filter = literal(True)
    elif current_user.role in [UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
        base_filter = Appointment.dealership_id == current_user.dealership_id
    else:
        base_filter = Appointment.assigned_to == current_user.id
    
    # Today's appointments
    today_result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                base_filter,
                Appointment.scheduled_at >= start_of_day,
                Appointment.scheduled_at < end_of_day,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
    )
    today = today_result.scalar() or 0
    
    # Upcoming (future, scheduled/confirmed)
    upcoming_result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                base_filter,
                Appointment.scheduled_at > now,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
    )
    upcoming = upcoming_result.scalar() or 0
    
    # Overdue (past, still scheduled/confirmed)
    overdue_result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                base_filter,
                Appointment.scheduled_at < now,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
    )
    overdue = overdue_result.scalar() or 0
    
    # Completed this week
    completed_result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                base_filter,
                Appointment.completed_at >= start_of_week,
                Appointment.status == AppointmentStatus.COMPLETED
            )
        )
    )
    completed_this_week = completed_result.scalar() or 0
    
    # Cancelled this week
    cancelled_result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                base_filter,
                Appointment.updated_at >= start_of_week,
                Appointment.status == AppointmentStatus.CANCELLED
            )
        )
    )
    cancelled_this_week = cancelled_result.scalar() or 0
    
    # Total scheduled
    total_result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                base_filter,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
            )
        )
    )
    total_scheduled = total_result.scalar() or 0
    
    return AppointmentStats(
        today=today,
        upcoming=upcoming,
        overdue=overdue,
        completed_this_week=completed_this_week,
        cancelled_this_week=cancelled_this_week,
        total_scheduled=total_scheduled
    )


@router.get("/{appointment_id}", response_model=AppointmentResponse)
async def get_appointment(
    appointment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get a single appointment by ID.
    """
    result = await db.execute(
        select(Appointment)
        .options(
            selectinload(Appointment.lead),
            selectinload(Appointment.dealership),
            selectinload(Appointment.scheduled_by_user),
            selectinload(Appointment.assigned_to_user)
        )
        .where(Appointment.id == appointment_id)
    )
    appointment = result.scalar_one_or_none()
    
    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )
    
    # Check access
    if current_user.role == UserRole.SUPER_ADMIN:
        pass
    elif current_user.role in [UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
        if appointment.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this appointment"
            )
    else:
        if appointment.assigned_to != current_user.id and appointment.scheduled_by != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this appointment"
            )
    
    return appointment


@router.put("/{appointment_id}", response_model=AppointmentResponse)
async def update_appointment(
    appointment_id: UUID,
    appointment_in: AppointmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update an appointment.
    """
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appointment = result.scalar_one_or_none()
    
    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )
    
    # Check access
    if current_user.role == UserRole.SUPER_ADMIN:
        pass
    elif current_user.role in [UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
        if appointment.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to update this appointment"
            )
    else:
        if appointment.assigned_to != current_user.id and appointment.scheduled_by != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to update this appointment"
            )
    
    # Update fields
    update_data = appointment_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(appointment, field, value)
    
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(Appointment)
        .options(
            selectinload(Appointment.lead),
            selectinload(Appointment.dealership),
            selectinload(Appointment.scheduled_by_user),
            selectinload(Appointment.assigned_to_user)
        )
        .where(Appointment.id == appointment.id)
    )
    appointment = result.scalar_one()
    
    return appointment


@router.post("/{appointment_id}/complete", response_model=AppointmentResponse)
async def complete_appointment(
    appointment_id: UUID,
    complete_data: AppointmentComplete,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Mark an appointment as completed.
    """
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appointment = result.scalar_one_or_none()
    
    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )
    
    # Check access
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
        if appointment.assigned_to != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to complete this appointment"
            )
    
    # Update appointment
    appointment.status = complete_data.status
    appointment.outcome_notes = complete_data.outcome_notes
    appointment.completed_at = utc_now()
    
    # Log activity if associated with a lead
    if appointment.lead_id:
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.APPOINTMENT_COMPLETED,
            description=f"Appointment completed: {appointment.title or 'Appointment'}",
            user_id=current_user.id,
            lead_id=appointment.lead_id,
            dealership_id=appointment.dealership_id,
            meta_data={
                "appointment_id": str(appointment.id),
                "status": appointment.status.value,
                "outcome_notes": appointment.outcome_notes,
                "performer_name": current_user.full_name
            }
        )
    
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(Appointment)
        .options(
            selectinload(Appointment.lead),
            selectinload(Appointment.dealership),
            selectinload(Appointment.scheduled_by_user),
            selectinload(Appointment.assigned_to_user)
        )
        .where(Appointment.id == appointment.id)
    )
    appointment = result.scalar_one()
    
    return appointment


@router.delete("/{appointment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_appointment(
    appointment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> None:
    """
    Delete (cancel) an appointment.
    """
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appointment = result.scalar_one_or_none()
    
    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found"
        )
    
    # Check access - only admins and creators can delete
    if current_user.role == UserRole.SUPER_ADMIN:
        pass
    elif current_user.role in [UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
        if appointment.dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to delete this appointment"
            )
    else:
        if appointment.scheduled_by != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the creator can delete this appointment"
            )
    
    # Mark as cancelled instead of hard delete
    appointment.status = AppointmentStatus.CANCELLED
    
    # Log activity if associated with a lead
    if appointment.lead_id:
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.APPOINTMENT_CANCELLED,
            description=f"Appointment cancelled: {appointment.title or 'Appointment'}",
            user_id=current_user.id,
            lead_id=appointment.lead_id,
            dealership_id=appointment.dealership_id,
            meta_data={
                "appointment_id": str(appointment.id),
                "performer_name": current_user.full_name
            }
        )
    
    await db.commit()
