"""
Reports and Admin Oversight API Endpoints

Provides endpoints for:
- Viewing salesperson pending tasks (follow-ups, appointments)
- Sending notifications from admin to salesperson
- Communication monitoring (calls, SMS) for admins
"""
import logging
from datetime import datetime, timedelta
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User, UserRole
from app.models.appointment import Appointment, AppointmentStatus
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.sms_log import SMSLog, MessageDirection
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


class UserCommunicationStats(BaseModel):
    user_id: str
    user_name: str
    total_calls: int
    inbound_calls: int
    outbound_calls: int
    total_call_duration: int  # seconds
    missed_calls: int
    total_sms_sent: int
    total_sms_received: int
    avg_response_time_minutes: Optional[float]


class CommunicationOverviewResponse(BaseModel):
    period_start: datetime
    period_end: datetime
    dealership_id: Optional[str]
    total_calls: int
    total_sms: int
    total_emails: int
    user_stats: List[UserCommunicationStats]


class TeamActivityItem(BaseModel):
    id: str
    type: str  # call, sms, email
    user_id: Optional[str]
    user_name: Optional[str]
    lead_id: Optional[str]
    lead_name: Optional[str]
    direction: str
    summary: str
    timestamp: datetime


class TeamActivityResponse(BaseModel):
    items: List[TeamActivityItem]
    total: int
    page: int
    page_size: int


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


@router.get("/communications/overview", response_model=CommunicationOverviewResponse)
async def get_communication_overview(
    days: int = Query(7, ge=1, le=90, description="Number of days to look back"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner)
) -> Any:
    """
    Get communication overview statistics for admin monitoring.
    Shows calls, SMS, and email stats grouped by user.
    """
    now = utc_now()
    period_start = now - timedelta(days=days)
    
    dealership_id = current_user.dealership_id if current_user.role != UserRole.SUPER_ADMIN else None
    
    # Build base filters
    call_filter = [CallLog.created_at >= period_start]
    sms_filter = [SMSLog.created_at >= period_start]
    
    if dealership_id:
        call_filter.append(CallLog.dealership_id == dealership_id)
        sms_filter.append(SMSLog.dealership_id == dealership_id)
    
    # Get call stats per user
    call_stats_result = await db.execute(
        select(
            CallLog.user_id,
            func.count(CallLog.id).label("total_calls"),
            func.sum(func.case([(CallLog.direction == CallDirection.INBOUND, 1)], else_=0)).label("inbound_calls"),
            func.sum(func.case([(CallLog.direction == CallDirection.OUTBOUND, 1)], else_=0)).label("outbound_calls"),
            func.sum(CallLog.duration_seconds).label("total_duration"),
            func.sum(func.case([
                (CallLog.status.in_([CallStatus.NO_ANSWER, CallStatus.BUSY, CallStatus.FAILED]), 1)
            ], else_=0)).label("missed_calls")
        )
        .where(and_(*call_filter))
        .group_by(CallLog.user_id)
    )
    call_stats = {row.user_id: row for row in call_stats_result.all()}
    
    # Get SMS stats per user
    sms_stats_result = await db.execute(
        select(
            SMSLog.user_id,
            func.sum(func.case([(SMSLog.direction == MessageDirection.OUTBOUND, 1)], else_=0)).label("sms_sent"),
            func.sum(func.case([(SMSLog.direction == MessageDirection.INBOUND, 1)], else_=0)).label("sms_received")
        )
        .where(and_(*sms_filter))
        .group_by(SMSLog.user_id)
    )
    sms_stats = {row.user_id: row for row in sms_stats_result.all()}
    
    # Get all user IDs with activity
    user_ids = set(call_stats.keys()) | set(sms_stats.keys())
    user_ids.discard(None)
    
    # Get user info
    users_result = await db.execute(
        select(User).where(User.id.in_(user_ids))
    )
    users = {u.id: u for u in users_result.scalars().all()}
    
    # Build per-user stats
    user_stats_list = []
    for uid in user_ids:
        user = users.get(uid)
        if not user:
            continue
        
        cs = call_stats.get(uid)
        ss = sms_stats.get(uid)
        
        user_stats_list.append(UserCommunicationStats(
            user_id=str(uid),
            user_name=user.full_name,
            total_calls=cs.total_calls if cs else 0,
            inbound_calls=cs.inbound_calls if cs else 0,
            outbound_calls=cs.outbound_calls if cs else 0,
            total_call_duration=cs.total_duration if cs and cs.total_duration else 0,
            missed_calls=cs.missed_calls if cs else 0,
            total_sms_sent=ss.sms_sent if ss else 0,
            total_sms_received=ss.sms_received if ss else 0,
            avg_response_time_minutes=None  # TODO: Calculate if needed
        ))
    
    # Sort by total activity
    user_stats_list.sort(key=lambda x: x.total_calls + x.total_sms_sent, reverse=True)
    
    # Get totals
    total_calls_result = await db.execute(
        select(func.count(CallLog.id)).where(and_(*call_filter))
    )
    total_calls = total_calls_result.scalar() or 0
    
    total_sms_result = await db.execute(
        select(func.count(SMSLog.id)).where(and_(*sms_filter))
    )
    total_sms = total_sms_result.scalar() or 0
    
    return CommunicationOverviewResponse(
        period_start=period_start,
        period_end=now,
        dealership_id=str(dealership_id) if dealership_id else None,
        total_calls=total_calls,
        total_sms=total_sms,
        total_emails=0,  # TODO: Add email stats
        user_stats=user_stats_list
    )


@router.get("/communications/activity", response_model=TeamActivityResponse)
async def get_team_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    user_id: Optional[UUID] = None,
    type: Optional[str] = Query(None, description="Filter by type: call, sms"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner)
) -> Any:
    """
    Get recent team communication activity feed.
    Shows calls and SMS in chronological order.
    """
    dealership_id = current_user.dealership_id if current_user.role != UserRole.SUPER_ADMIN else None
    
    items = []
    
    # Get calls
    if not type or type == "call":
        call_query = select(CallLog, User, Lead).outerjoin(
            User, CallLog.user_id == User.id
        ).outerjoin(
            Lead, CallLog.lead_id == Lead.id
        )
        
        if dealership_id:
            call_query = call_query.where(CallLog.dealership_id == dealership_id)
        if user_id:
            call_query = call_query.where(CallLog.user_id == user_id)
        
        call_query = call_query.order_by(CallLog.created_at.desc()).limit(page_size)
        
        call_result = await db.execute(call_query)
        for call, user, lead in call_result.all():
            items.append(TeamActivityItem(
                id=str(call.id),
                type="call",
                user_id=str(call.user_id) if call.user_id else None,
                user_name=user.full_name if user else None,
                lead_id=str(call.lead_id) if call.lead_id else None,
                lead_name=lead.full_name if lead else None,
                direction=call.direction.value,
                summary=f"{call.direction.value.capitalize()} call - {call.status.value} ({call.duration_seconds}s)",
                timestamp=call.created_at
            ))
    
    # Get SMS
    if not type or type == "sms":
        sms_query = select(SMSLog, User, Lead).outerjoin(
            User, SMSLog.user_id == User.id
        ).outerjoin(
            Lead, SMSLog.lead_id == Lead.id
        )
        
        if dealership_id:
            sms_query = sms_query.where(SMSLog.dealership_id == dealership_id)
        if user_id:
            sms_query = sms_query.where(SMSLog.user_id == user_id)
        
        sms_query = sms_query.order_by(SMSLog.created_at.desc()).limit(page_size)
        
        sms_result = await db.execute(sms_query)
        for sms, user, lead in sms_result.all():
            items.append(TeamActivityItem(
                id=str(sms.id),
                type="sms",
                user_id=str(sms.user_id) if sms.user_id else None,
                user_name=user.full_name if user else None,
                lead_id=str(sms.lead_id) if sms.lead_id else None,
                lead_name=lead.full_name if lead else None,
                direction=sms.direction.value,
                summary=f"SMS {sms.direction.value}: {sms.body[:50]}..." if len(sms.body) > 50 else f"SMS {sms.direction.value}: {sms.body}",
                timestamp=sms.created_at
            ))
    
    # Sort by timestamp
    items.sort(key=lambda x: x.timestamp, reverse=True)
    
    # Paginate
    offset = (page - 1) * page_size
    paginated_items = items[offset:offset + page_size]
    
    return TeamActivityResponse(
        items=paginated_items,
        total=len(items),
        page=page,
        page_size=page_size
    )
