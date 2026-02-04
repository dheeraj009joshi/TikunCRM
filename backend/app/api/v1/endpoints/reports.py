"""
Reports and Admin Oversight API Endpoints

Provides endpoints for:
- Viewing salesperson pending tasks (follow-ups, appointments)
- Sending notifications from admin to salesperson
"""
import logging
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User, UserRole
from app.models.appointment import Appointment, AppointmentStatus
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

router = APIRouter()


# Schemas
class PendingFollowUp(BaseModel):
    id: str
    lead_id: str
    lead_name: str
    scheduled_at: datetime
    notes: Optional[str]
    is_overdue: bool
    
    class Config:
        from_attributes = True


class PendingAppointment(BaseModel):
    id: str
    lead_id: str
    lead_name: str
    title: Optional[str]
    scheduled_at: datetime
    location: Optional[str]
    is_overdue: bool
    
    class Config:
        from_attributes = True


class SalespersonPendingTasksResponse(BaseModel):
    user_id: str
    user_name: str
    overdue_followups: List[PendingFollowUp]
    upcoming_followups: List[PendingFollowUp]
    overdue_appointments: List[PendingAppointment]
    upcoming_appointments: List[PendingAppointment]
    total_overdue: int
    total_upcoming: int


class AdminNotificationRequest(BaseModel):
    custom_message: Optional[str] = None
    include_pending_tasks: bool = True


class AdminNotificationResponse(BaseModel):
    success: bool
    message: str
    notification_id: Optional[str]


# Helper function to check admin/owner permissions
def require_admin_or_owner(current_user: User = Depends(deps.get_current_active_user)) -> User:
    """Require user to be dealership admin, owner, or super admin."""
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators and owners can access this endpoint"
        )
    return current_user


@router.get("/salesperson/{user_id}/pending-tasks", response_model=SalespersonPendingTasksResponse)
async def get_salesperson_pending_tasks(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner)
) -> Any:
    """
    Get all pending follow-ups and appointments for a salesperson.
    Shows both overdue and upcoming items.
    """
    # Verify the target user exists and is in the same dealership (if not super admin)
    target_user_result = await db.execute(select(User).where(User.id == user_id))
    target_user = target_user_result.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Permission check: non-super-admins can only view users in their dealership
    if current_user.role != UserRole.SUPER_ADMIN:
        if target_user.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Cannot view users from other dealerships")
    
    now = utc_now()
    
    # Get follow-ups
    followups_result = await db.execute(
        select(FollowUp)
        .where(
            FollowUp.assigned_to == user_id,
            FollowUp.status == FollowUpStatus.PENDING
        )
        .order_by(FollowUp.scheduled_at)
    )
    followups = followups_result.scalars().all()
    
    # Get appointments
    appointments_result = await db.execute(
        select(Appointment)
        .where(
            Appointment.assigned_to == user_id,
            Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED])
        )
        .order_by(Appointment.scheduled_at)
    )
    appointments = appointments_result.scalars().all()
    
    # Get lead names
    lead_ids = set([f.lead_id for f in followups] + [a.lead_id for a in appointments if a.lead_id])
    leads_result = await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
    leads = {lead.id: lead for lead in leads_result.scalars().all()}
    
    # Categorize follow-ups
    overdue_followups = []
    upcoming_followups = []
    
    for followup in followups:
        lead = leads.get(followup.lead_id)
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() if lead else "Unknown"
        
        is_overdue = followup.scheduled_at < now
        
        pending_followup = PendingFollowUp(
            id=str(followup.id),
            lead_id=str(followup.lead_id),
            lead_name=lead_name,
            scheduled_at=followup.scheduled_at,
            notes=followup.notes,
            is_overdue=is_overdue
        )
        
        if is_overdue:
            overdue_followups.append(pending_followup)
        else:
            upcoming_followups.append(pending_followup)
    
    # Categorize appointments
    overdue_appointments = []
    upcoming_appointments = []
    
    for appointment in appointments:
        lead = leads.get(appointment.lead_id) if appointment.lead_id else None
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() if lead else "No lead"
        
        is_overdue = appointment.scheduled_at < now
        
        pending_appointment = PendingAppointment(
            id=str(appointment.id),
            lead_id=str(appointment.lead_id) if appointment.lead_id else "",
            lead_name=lead_name,
            title=appointment.title,
            scheduled_at=appointment.scheduled_at,
            location=appointment.location,
            is_overdue=is_overdue
        )
        
        if is_overdue:
            overdue_appointments.append(pending_appointment)
        else:
            upcoming_appointments.append(pending_appointment)
    
    return SalespersonPendingTasksResponse(
        user_id=str(target_user.id),
        user_name=f"{target_user.first_name} {target_user.last_name}",
        overdue_followups=overdue_followups,
        upcoming_followups=upcoming_followups,
        overdue_appointments=overdue_appointments,
        upcoming_appointments=upcoming_appointments,
        total_overdue=len(overdue_followups) + len(overdue_appointments),
        total_upcoming=len(upcoming_followups) + len(upcoming_appointments)
    )


@router.post("/notify-salesperson/{user_id}", response_model=AdminNotificationResponse)
async def notify_salesperson_about_tasks(
    user_id: UUID,
    notification_in: AdminNotificationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner)
) -> Any:
    """
    Admin/Owner sends notification to salesperson about pending tasks.
    Sends via all channels: push, email, and SMS.
    """
    # Verify the target user exists and is in the same dealership (if not super admin)
    target_user_result = await db.execute(select(User).where(User.id == user_id))
    target_user = target_user_result.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Permission check
    if current_user.role != UserRole.SUPER_ADMIN:
        if target_user.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Cannot notify users from other dealerships")
    
    # Get pending tasks if requested
    pending_tasks = None
    if notification_in.include_pending_tasks:
        # Get the pending tasks
        now = utc_now()
        
        # Overdue follow-ups
        overdue_followups_result = await db.execute(
            select(FollowUp)
            .where(
                FollowUp.assigned_to == user_id,
                FollowUp.status == FollowUpStatus.PENDING,
                FollowUp.scheduled_at < now
            )
        )
        overdue_followups = overdue_followups_result.scalars().all()
        
        # Overdue appointments
        overdue_appointments_result = await db.execute(
            select(Appointment)
            .where(
                Appointment.assigned_to == user_id,
                Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]),
                Appointment.scheduled_at < now
            )
        )
        overdue_appointments = overdue_appointments_result.scalars().all()
        
        # Build pending tasks data
        pending_tasks = {
            "overdue_followups": [
                {
                    "id": str(f.id),
                    "lead_id": str(f.lead_id),
                    "scheduled_at": f.scheduled_at.isoformat()
                }
                for f in overdue_followups
            ],
            "overdue_appointments": [
                {
                    "id": str(a.id),
                    "lead_id": str(a.lead_id) if a.lead_id else None,
                    "scheduled_at": a.scheduled_at.isoformat()
                }
                for a in overdue_appointments
            ]
        }
    
    # Send notification
    notification_service = NotificationService(db)
    admin_name = f"{current_user.first_name} {current_user.last_name}"
    
    try:
        notification = await notification_service.notify_admin_reminder_to_salesperson(
            user_id=user_id,
            admin_name=admin_name,
            custom_message=notification_in.custom_message,
            pending_tasks=pending_tasks
        )
        
        await db.commit()
        
        logger.info(f"Admin {current_user.id} sent notification to salesperson {user_id}")
        
        return AdminNotificationResponse(
            success=True,
            message=f"Notification sent to {target_user.first_name} {target_user.last_name}",
            notification_id=str(notification.id)
        )
        
    except Exception as e:
        logger.error(f"Failed to send notification: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send notification: {str(e)}"
        )
