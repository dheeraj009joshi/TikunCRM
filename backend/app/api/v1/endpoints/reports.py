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
from sqlalchemy import select, func, and_, or_, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User, UserRole
from app.models.appointment import Appointment, AppointmentStatus
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead, LeadSource
from app.models.lead_stage import LeadStage
from app.models.activity import Activity, ActivityType
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.sms_log import SMSLog, MessageDirection
from app.models.showroom_visit import ShowroomVisit
from app.models.customer import Customer
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


class DealershipSummary(BaseModel):
    total_leads: int
    total_notes: int
    total_appointments: int
    total_follow_ups: int
    active_leads: int
    converted_leads: int
    # In-period (date range) counts
    total_follow_ups_scheduled_in_period: int
    total_follow_ups_completed_in_period: int
    total_appointments_scheduled_in_period: int
    total_appointments_confirmed_in_period: int
    # Day-of-week (in period): Friday = notes + outbound calls, Saturday = appointments
    notes_friday: int
    outbound_calls_friday: int
    appointments_contacted_saturday: int
    # Showroom check-ins in period
    total_check_ins_in_period: int


class SalespersonAnalysisRow(BaseModel):
    user_id: str
    user_name: str
    leads_assigned: int
    notes_added: int
    follow_ups_total: int
    follow_ups_pending: int
    follow_ups_overdue: int
    appointments_total: int
    appointments_scheduled: int  # status = scheduled only
    appointments_confirmed: int  # status = confirmed only
    last_note_content: Optional[str] = None  # text of most recent note on their leads
    # In-period (date range) counts
    follow_ups_scheduled_in_period: int
    follow_ups_completed_in_period: int
    appointments_scheduled_in_period: int
    appointments_confirmed_in_period: int
    notes_friday: int
    outbound_calls_friday: int
    appointments_contacted_saturday: int
    check_ins_in_period: int


class CheckInRow(BaseModel):
    """One showroom check-in in the report period."""
    visit_id: str
    lead_id: str
    lead_name: str
    assigned_to_id: Optional[str] = None
    assigned_to_name: Optional[str] = None
    checked_in_at: datetime
    checked_in_by_name: Optional[str] = None
    outcome: Optional[str] = None  # sold, not_interested, follow_up, etc.


class DealershipAnalysisResponse(BaseModel):
    summary: DealershipSummary
    salespeople: List[SalespersonAnalysisRow]
    check_ins: List[CheckInRow] = []  # Check-ins in period (for dedicated table)


class LeadsOverTimeItem(BaseModel):
    date: str  # YYYY-MM-DD
    leads_created: int = 0
    leads_converted: int = 0


class LeadsOverTimeResponse(BaseModel):
    series: List[LeadsOverTimeItem]


class LeadsByStageItem(BaseModel):
    stage_id: str
    stage_name: str
    count: int


class LeadsByStageResponse(BaseModel):
    items: List[LeadsByStageItem]


class LeadsBySourceItem(BaseModel):
    source: str
    count: int


class LeadsBySourceResponse(BaseModel):
    items: List[LeadsBySourceItem]


class ActivitiesOverTimeItem(BaseModel):
    date: str
    activities: int = 0
    notes: int = 0


class ActivitiesOverTimeResponse(BaseModel):
    series: List[ActivitiesOverTimeItem]


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


def _resolve_dealership_and_lead_filters(
    current_user: User,
    dealership_id: Optional[UUID],
    assigned_to: Optional[UUID],
    source: Optional[str],
    stage_id: Optional[UUID],
):
    """Returns (resolved_dealership_id, list of Lead filter conditions)."""
    if current_user.role == UserRole.SUPER_ADMIN and dealership_id is not None:
        resolved = dealership_id
    else:
        resolved = current_user.dealership_id
    lead_filters = [Lead.dealership_id == resolved] if resolved else []
    if assigned_to is not None:
        lead_filters.append(Lead.assigned_to == assigned_to)
    if source is not None:
        try:
            lead_filters.append(Lead.source == LeadSource(source))
        except ValueError:
            pass
    if stage_id is not None:
        lead_filters.append(Lead.stage_id == stage_id)
    return resolved, lead_filters


@router.get("/analysis", response_model=DealershipAnalysisResponse)
async def get_dealership_analysis(
    date_from: Optional[str] = Query(None, description="ISO date for range start"),
    date_to: Optional[str] = Query(None, description="ISO date for range end"),
    dealership_id: Optional[UUID] = Query(None, description="Dealership to scope (super_admin only)"),
    assigned_to: Optional[UUID] = Query(None, description="Filter by salesperson"),
    source: Optional[str] = Query(None, description="Filter by lead source"),
    stage_id: Optional[UUID] = Query(None, description="Filter by stage"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner),
) -> Any:
    """
    Full dealership analysis: summary totals and per-salesperson metrics.
    Optional date range applies to activity/note counts. All counts respect assigned_to, source, stage_id filters.
    """
    now = utc_now()
    resolved_dealership_id, lead_filters = _resolve_dealership_and_lead_filters(
        current_user, dealership_id, assigned_to, source, stage_id
    )
    if not resolved_dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dealership context required. Set dealership_id (super_admin) or use a dealership user.",
        )
    lead_filters_base = and_(*lead_filters) if lead_filters else (Lead.dealership_id == resolved_dealership_id)

    # Optional activity date range
    activity_date_from = None
    activity_date_to = None
    if date_from:
        try:
            activity_date_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
        except ValueError:
            pass
    if date_to:
        try:
            activity_date_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
        except ValueError:
            pass

    # --- Dealership summary (filtered by lead_filters) ---
    total_leads_result = await db.execute(select(func.count()).select_from(Lead).where(lead_filters_base))
    total_leads = total_leads_result.scalar() or 0

    active_result = await db.execute(
        select(func.count()).select_from(Lead).where(and_(lead_filters_base, Lead.is_active == True))
    )
    active_leads = active_result.scalar() or 0
    converted_result = await db.execute(
        select(func.count()).select_from(Lead).where(and_(lead_filters_base, Lead.outcome == "converted"))
    )
    converted_leads = converted_result.scalar() or 0

    lead_ids_result = await db.execute(select(Lead.id).where(lead_filters_base))
    lead_ids = [r[0] for r in lead_ids_result.fetchall()]

    activity_filters = [Activity.dealership_id == resolved_dealership_id]
    if lead_ids:
        activity_filters.append(Activity.lead_id.in_(lead_ids))
    if activity_date_from is not None:
        activity_filters.append(Activity.created_at >= activity_date_from)
    if activity_date_to is not None:
        activity_filters.append(Activity.created_at <= activity_date_to)

    total_notes_result = await db.execute(
        select(func.count()).select_from(Activity).where(
            and_(*activity_filters, Activity.type == ActivityType.NOTE_ADDED)
        )
    )
    total_notes = total_notes_result.scalar() or 0

    appt_filters = [Appointment.dealership_id == resolved_dealership_id]
    if lead_ids:
        appt_filters.append(
            or_(Appointment.lead_id.is_(None), Appointment.lead_id.in_(lead_ids))
        )
    if activity_date_from is not None:
        appt_filters.append(Appointment.created_at >= activity_date_from)
    if activity_date_to is not None:
        appt_filters.append(Appointment.created_at <= activity_date_to)
    appt_filters_base = and_(*appt_filters)
    total_appointments_scheduled_in_period_result = await db.execute(
        select(func.count()).select_from(Appointment).where(
            and_(appt_filters_base, Appointment.status == AppointmentStatus.SCHEDULED)
        )
    )
    total_appointments_scheduled_in_period = total_appointments_scheduled_in_period_result.scalar() or 0
    total_appointments_confirmed_in_period_result = await db.execute(
        select(func.count()).select_from(Appointment).where(
            and_(appt_filters_base, Appointment.status == AppointmentStatus.CONFIRMED)
        )
    )
    total_appointments_confirmed_in_period = total_appointments_confirmed_in_period_result.scalar() or 0
    total_appointments = total_appointments_scheduled_in_period + total_appointments_confirmed_in_period

    if lead_ids:
        fu_scheduled_filters = [FollowUp.lead_id.in_(lead_ids)]
        fu_completed_filters = [FollowUp.lead_id.in_(lead_ids), FollowUp.status == FollowUpStatus.COMPLETED]
        if activity_date_from is not None:
            fu_scheduled_filters.append(FollowUp.created_at >= activity_date_from)
            fu_completed_filters.append(FollowUp.completed_at >= activity_date_from)
        if activity_date_to is not None:
            fu_scheduled_filters.append(FollowUp.created_at <= activity_date_to)
            fu_completed_filters.append(FollowUp.completed_at <= activity_date_to)
        total_follow_ups_scheduled_result = await db.execute(
            select(func.count()).select_from(FollowUp).where(and_(*fu_scheduled_filters))
        )
        total_follow_ups_scheduled_in_period = total_follow_ups_scheduled_result.scalar() or 0
        total_follow_ups_completed_result = await db.execute(
            select(func.count()).select_from(FollowUp).where(and_(*fu_completed_filters))
        )
        total_follow_ups_completed_in_period = total_follow_ups_completed_result.scalar() or 0
    else:
        total_follow_ups_scheduled_in_period = 0
        total_follow_ups_completed_in_period = 0
    total_follow_ups = total_follow_ups_scheduled_in_period + total_follow_ups_completed_in_period

    # Day-of-week metrics (only when date range is set; dow 0=Sun, 5=Fri, 6=Sat)
    notes_friday = 0
    outbound_calls_friday = 0
    appointments_contacted_saturday = 0
    if activity_date_from is not None and activity_date_to is not None:
        notes_fri_filters = list(activity_filters) + [Activity.type == ActivityType.NOTE_ADDED, extract("dow", Activity.created_at) == 5]
        notes_friday_result = await db.execute(
            select(func.count()).select_from(Activity).where(and_(*notes_fri_filters))
        )
        notes_friday = notes_friday_result.scalar() or 0
        call_fri_filters = [
            CallLog.dealership_id == resolved_dealership_id,
            CallLog.direction == CallDirection.OUTBOUND,
            CallLog.started_at >= activity_date_from,
            CallLog.started_at <= activity_date_to,
            extract("dow", CallLog.started_at) == 5,
        ]
        if lead_ids:
            call_fri_filters.append(
                or_(CallLog.lead_id.is_(None), CallLog.lead_id.in_(lead_ids))
            )
        outbound_calls_friday_result = await db.execute(
            select(func.count()).select_from(CallLog).where(and_(*call_fri_filters))
        )
        outbound_calls_friday = outbound_calls_friday_result.scalar() or 0
        appt_sat_filters = [
            Appointment.dealership_id == resolved_dealership_id,
            Appointment.scheduled_at >= activity_date_from,
            Appointment.scheduled_at <= activity_date_to,
            extract("dow", Appointment.scheduled_at) == 6,
        ]
        if lead_ids:
            appt_sat_filters.append(
                or_(Appointment.lead_id.is_(None), Appointment.lead_id.in_(lead_ids))
            )
        appointments_contacted_saturday_result = await db.execute(
            select(func.count()).select_from(Appointment).where(and_(*appt_sat_filters))
        )
        appointments_contacted_saturday = appointments_contacted_saturday_result.scalar() or 0

    # Check-ins in period (showroom visits with checked_in_at in date range)
    total_check_ins_in_period = 0
    if lead_ids and activity_date_from is not None and activity_date_to is not None:
        check_in_filters = [
            ShowroomVisit.dealership_id == resolved_dealership_id,
            ShowroomVisit.lead_id.in_(lead_ids),
            ShowroomVisit.checked_in_at >= activity_date_from,
            ShowroomVisit.checked_in_at <= activity_date_to,
        ]
        check_in_result = await db.execute(
            select(func.count()).select_from(ShowroomVisit).where(and_(*check_in_filters))
        )
        total_check_ins_in_period = check_in_result.scalar() or 0

    summary = DealershipSummary(
        total_leads=total_leads,
        total_notes=total_notes,
        total_appointments=total_appointments,
        total_follow_ups=total_follow_ups,
        active_leads=active_leads,
        converted_leads=converted_leads,
        total_follow_ups_scheduled_in_period=total_follow_ups_scheduled_in_period,
        total_follow_ups_completed_in_period=total_follow_ups_completed_in_period,
        total_appointments_scheduled_in_period=total_appointments_scheduled_in_period,
        total_appointments_confirmed_in_period=total_appointments_confirmed_in_period,
        notes_friday=notes_friday,
        outbound_calls_friday=outbound_calls_friday,
        appointments_contacted_saturday=appointments_contacted_saturday,
        total_check_ins_in_period=total_check_ins_in_period,
    )

    # --- Latest note content per salesperson: one row per assigned_to via subquery (avoids loading all rows) ---
    last_note_subq = (
        select(
            Lead.assigned_to.label("assigned_to"),
            func.max(Activity.created_at).label("max_ts"),
        )
        .select_from(Activity)
        .join(Lead, Lead.id == Activity.lead_id)
        .where(
            and_(
                Activity.type == ActivityType.NOTE_ADDED,
                Lead.assigned_to.isnot(None),
                Lead.dealership_id == resolved_dealership_id,
                Activity.user_id == Lead.assigned_to,
            )
        )
        .group_by(Lead.assigned_to)
        .subquery()
    )
    last_note_q = (
        select(Lead.assigned_to, Activity.meta_data)
        .select_from(Activity)
        .join(Lead, Lead.id == Activity.lead_id)
        .join(
            last_note_subq,
            and_(
                Lead.assigned_to == last_note_subq.c.assigned_to,
                Activity.created_at == last_note_subq.c.max_ts,
            ),
        )
        .where(
            and_(
                Activity.type == ActivityType.NOTE_ADDED,
                Lead.dealership_id == resolved_dealership_id,
                Activity.user_id == Lead.assigned_to,
            )
        )
    )
    if lead_ids:
        last_note_q = last_note_q.where(Activity.lead_id.in_(lead_ids))
    last_note_result = await db.execute(last_note_q)
    last_note_rows = last_note_result.all()
    last_note_by_user: dict[UUID, str] = {}
    for row in last_note_rows:
        if row.assigned_to and row.assigned_to not in last_note_by_user:
            meta = row.meta_data if isinstance(row.meta_data, dict) else {}
            content = meta.get("content") if meta else None
            if content:
                last_note_by_user[row.assigned_to] = content

    # --- Per-salesperson: fetch all salespersons then batch all counts (GROUP BY) to avoid N*17 queries ---
    salespersons_result = await db.execute(
        select(User).where(
            and_(
                User.dealership_id == resolved_dealership_id,
                User.role == UserRole.SALESPERSON,
                User.is_active == True,
            )
        )
    )
    salespersons = salespersons_result.scalars().all()
    sp_ids = [sp.id for sp in salespersons]
    now_ts = now

    # Defaults per sp (all zeros)
    sp_data: dict[UUID, dict[str, int]] = {sp_id: {
        "leads_assigned": 0, "notes_added": 0,
        "follow_ups_total": 0, "follow_ups_pending": 0, "follow_ups_overdue": 0,
        "follow_ups_scheduled_in_period": 0, "follow_ups_completed_in_period": 0,
        "appointments_total": 0, "appointments_scheduled": 0, "appointments_confirmed": 0,
        "appointments_scheduled_in_period": 0, "appointments_confirmed_in_period": 0,
        "notes_friday": 0, "outbound_calls_friday": 0, "appointments_contacted_saturday": 0,
        "check_ins_in_period": 0,
    } for sp_id in sp_ids}

    if sp_ids:
        # Leads per assigned_to
        lead_sp_base = and_(lead_filters_base, Lead.assigned_to.in_(sp_ids))
        lead_sp_result = await db.execute(
            select(Lead.assigned_to, func.count()).select_from(Lead).where(lead_sp_base).group_by(Lead.assigned_to)
        )
        for row in lead_sp_result.all():
            if row[0]:
                sp_data[row[0]]["leads_assigned"] = row[1] or 0

        # Notes in period per user_id
        note_sp_filters = [Activity.user_id.in_(sp_ids), Activity.type == ActivityType.NOTE_ADDED]
        if activity_date_from is not None:
            note_sp_filters.append(Activity.created_at >= activity_date_from)
        if activity_date_to is not None:
            note_sp_filters.append(Activity.created_at <= activity_date_to)
        note_sp_result = await db.execute(
            select(Activity.user_id, func.count()).select_from(Activity).where(and_(*note_sp_filters)).group_by(Activity.user_id)
        )
        for row in note_sp_result.all():
            if row[0]:
                sp_data[row[0]]["notes_added"] = row[1] or 0

        # FollowUp: total, pending, overdue
        fu_total_result = await db.execute(
            select(FollowUp.assigned_to, func.count()).select_from(FollowUp).where(FollowUp.assigned_to.in_(sp_ids)).group_by(FollowUp.assigned_to)
        )
        for row in fu_total_result.all():
            if row[0]:
                sp_data[row[0]]["follow_ups_total"] = row[1] or 0
        fu_pending_result = await db.execute(
            select(FollowUp.assigned_to, func.count()).select_from(FollowUp).where(
                and_(FollowUp.assigned_to.in_(sp_ids), FollowUp.status == FollowUpStatus.PENDING)
            ).group_by(FollowUp.assigned_to)
        )
        for row in fu_pending_result.all():
            if row[0]:
                sp_data[row[0]]["follow_ups_pending"] = row[1] or 0
        fu_overdue_result = await db.execute(
            select(FollowUp.assigned_to, func.count()).select_from(FollowUp).where(
                and_(
                    FollowUp.assigned_to.in_(sp_ids),
                    FollowUp.status == FollowUpStatus.PENDING,
                    FollowUp.scheduled_at < now_ts,
                )
            ).group_by(FollowUp.assigned_to)
        )
        for row in fu_overdue_result.all():
            if row[0]:
                sp_data[row[0]]["follow_ups_overdue"] = row[1] or 0

        # FollowUp: scheduled/completed in period
        fu_sched_filters = [FollowUp.assigned_to.in_(sp_ids)]
        if lead_ids:
            fu_sched_filters.append(FollowUp.lead_id.in_(lead_ids))
        if activity_date_from is not None:
            fu_sched_filters.append(FollowUp.created_at >= activity_date_from)
        if activity_date_to is not None:
            fu_sched_filters.append(FollowUp.created_at <= activity_date_to)
        fu_sched_result = await db.execute(
            select(FollowUp.assigned_to, func.count()).select_from(FollowUp).where(and_(*fu_sched_filters)).group_by(FollowUp.assigned_to)
        )
        for row in fu_sched_result.all():
            if row[0]:
                sp_data[row[0]]["follow_ups_scheduled_in_period"] = row[1] or 0
        fu_done_filters = [FollowUp.assigned_to.in_(sp_ids), FollowUp.status == FollowUpStatus.COMPLETED]
        if lead_ids:
            fu_done_filters.append(FollowUp.lead_id.in_(lead_ids))
        if activity_date_from is not None:
            fu_done_filters.append(FollowUp.completed_at >= activity_date_from)
        if activity_date_to is not None:
            fu_done_filters.append(FollowUp.completed_at <= activity_date_to)
        fu_done_result = await db.execute(
            select(FollowUp.assigned_to, func.count()).select_from(FollowUp).where(and_(*fu_done_filters)).group_by(FollowUp.assigned_to)
        )
        for row in fu_done_result.all():
            if row[0]:
                sp_data[row[0]]["follow_ups_completed_in_period"] = row[1] or 0

        # Appointments: total, scheduled, confirmed (all-time)
        appt_total_result = await db.execute(
            select(Appointment.assigned_to, func.count()).select_from(Appointment).where(
                Appointment.assigned_to.in_(sp_ids)
            ).group_by(Appointment.assigned_to)
        )
        for row in appt_total_result.all():
            if row[0]:
                sp_data[row[0]]["appointments_total"] = row[1] or 0
        appt_sched_result = await db.execute(
            select(Appointment.assigned_to, func.count()).select_from(Appointment).where(
                and_(Appointment.assigned_to.in_(sp_ids), Appointment.status == AppointmentStatus.SCHEDULED)
            ).group_by(Appointment.assigned_to)
        )
        for row in appt_sched_result.all():
            if row[0]:
                sp_data[row[0]]["appointments_scheduled"] = row[1] or 0
        appt_conf_result = await db.execute(
            select(Appointment.assigned_to, func.count()).select_from(Appointment).where(
                and_(Appointment.assigned_to.in_(sp_ids), Appointment.status == AppointmentStatus.CONFIRMED)
            ).group_by(Appointment.assigned_to)
        )
        for row in appt_conf_result.all():
            if row[0]:
                sp_data[row[0]]["appointments_confirmed"] = row[1] or 0

        # Appointments: scheduled/confirmed in period
        appt_period_filters = [
            Appointment.assigned_to.in_(sp_ids),
            Appointment.dealership_id == resolved_dealership_id,
        ]
        if lead_ids:
            appt_period_filters.append(or_(Appointment.lead_id.is_(None), Appointment.lead_id.in_(lead_ids)))
        if activity_date_from is not None:
            appt_period_filters.append(Appointment.created_at >= activity_date_from)
        if activity_date_to is not None:
            appt_period_filters.append(Appointment.created_at <= activity_date_to)
        appt_period_base = and_(*appt_period_filters)
        appt_sched_period_result = await db.execute(
            select(Appointment.assigned_to, func.count()).select_from(Appointment).where(
                and_(appt_period_base, Appointment.status == AppointmentStatus.SCHEDULED)
            ).group_by(Appointment.assigned_to)
        )
        for row in appt_sched_period_result.all():
            if row[0]:
                sp_data[row[0]]["appointments_scheduled_in_period"] = row[1] or 0
        appt_conf_period_result = await db.execute(
            select(Appointment.assigned_to, func.count()).select_from(Appointment).where(
                and_(appt_period_base, Appointment.status == AppointmentStatus.CONFIRMED)
            ).group_by(Appointment.assigned_to)
        )
        for row in appt_conf_period_result.all():
            if row[0]:
                sp_data[row[0]]["appointments_confirmed_in_period"] = row[1] or 0

        # Day-of-week: notes Friday, outbound calls Friday, appointments Saturday
        if activity_date_from is not None and activity_date_to is not None:
            nf_sp_filters = [
                Activity.user_id.in_(sp_ids),
                Activity.type == ActivityType.NOTE_ADDED,
                Activity.created_at >= activity_date_from,
                Activity.created_at <= activity_date_to,
                extract("dow", Activity.created_at) == 5,
            ]
            nf_sp_result = await db.execute(
                select(Activity.user_id, func.count()).select_from(Activity).where(and_(*nf_sp_filters)).group_by(Activity.user_id)
            )
            for row in nf_sp_result.all():
                if row[0]:
                    sp_data[row[0]]["notes_friday"] = row[1] or 0
            oc_sp_filters = [
                CallLog.user_id.in_(sp_ids),
                CallLog.direction == CallDirection.OUTBOUND,
                CallLog.started_at >= activity_date_from,
                CallLog.started_at <= activity_date_to,
                extract("dow", CallLog.started_at) == 5,
            ]
            if lead_ids:
                oc_sp_filters.append(or_(CallLog.lead_id.is_(None), CallLog.lead_id.in_(lead_ids)))
            oc_sp_result = await db.execute(
                select(CallLog.user_id, func.count()).select_from(CallLog).where(and_(*oc_sp_filters)).group_by(CallLog.user_id)
            )
            for row in oc_sp_result.all():
                if row[0]:
                    sp_data[row[0]]["outbound_calls_friday"] = row[1] or 0
            ap_sat_sp_filters = [
                Appointment.assigned_to.in_(sp_ids),
                Appointment.dealership_id == resolved_dealership_id,
                Appointment.scheduled_at >= activity_date_from,
                Appointment.scheduled_at <= activity_date_to,
                extract("dow", Appointment.scheduled_at) == 6,
            ]
            if lead_ids:
                ap_sat_sp_filters.append(or_(Appointment.lead_id.is_(None), Appointment.lead_id.in_(lead_ids)))
            ap_sat_sp_result = await db.execute(
                select(Appointment.assigned_to, func.count()).select_from(Appointment).where(and_(*ap_sat_sp_filters)).group_by(Appointment.assigned_to)
            )
            for row in ap_sat_sp_result.all():
                if row[0]:
                    sp_data[row[0]]["appointments_contacted_saturday"] = row[1] or 0

        # Check-ins in period (showroom visits for leads assigned to each salesperson)
        if lead_ids and activity_date_from is not None and activity_date_to is not None:
            check_in_sp_q = (
                select(Lead.assigned_to, func.count())
                .select_from(ShowroomVisit)
                .join(Lead, Lead.id == ShowroomVisit.lead_id)
                .where(
                    and_(
                        Lead.assigned_to.in_(sp_ids),
                        ShowroomVisit.dealership_id == resolved_dealership_id,
                        ShowroomVisit.lead_id.in_(lead_ids),
                        ShowroomVisit.checked_in_at >= activity_date_from,
                        ShowroomVisit.checked_in_at <= activity_date_to,
                    )
                )
                .group_by(Lead.assigned_to)
            )
            check_in_sp_result = await db.execute(check_in_sp_q)
            for row in check_in_sp_result.all():
                if row[0]:
                    sp_data[row[0]]["check_ins_in_period"] = row[1] or 0

    salespeople_rows = [
        SalespersonAnalysisRow(
            user_id=str(sp.id),
            user_name=sp.full_name,
            leads_assigned=sp_data[sp.id]["leads_assigned"],
            notes_added=sp_data[sp.id]["notes_added"],
            follow_ups_total=sp_data[sp.id]["follow_ups_total"],
            follow_ups_pending=sp_data[sp.id]["follow_ups_pending"],
            follow_ups_overdue=sp_data[sp.id]["follow_ups_overdue"],
            appointments_total=sp_data[sp.id]["appointments_total"],
            appointments_scheduled=sp_data[sp.id]["appointments_scheduled"],
            appointments_confirmed=sp_data[sp.id]["appointments_confirmed"],
            last_note_content=last_note_by_user.get(sp.id),
            follow_ups_scheduled_in_period=sp_data[sp.id]["follow_ups_scheduled_in_period"],
            follow_ups_completed_in_period=sp_data[sp.id]["follow_ups_completed_in_period"],
            appointments_scheduled_in_period=sp_data[sp.id]["appointments_scheduled_in_period"],
            appointments_confirmed_in_period=sp_data[sp.id]["appointments_confirmed_in_period"],
            notes_friday=sp_data[sp.id]["notes_friday"],
            outbound_calls_friday=sp_data[sp.id]["outbound_calls_friday"],
            appointments_contacted_saturday=sp_data[sp.id]["appointments_contacted_saturday"],
            check_ins_in_period=sp_data[sp.id]["check_ins_in_period"],
        )
        for sp in salespersons
    ]

    # Check-ins table: list of showroom visits in period (for dedicated table on frontend)
    check_ins_list: List[CheckInRow] = []
    if activity_date_from is not None and activity_date_to is not None:
        check_in_list_filters = [
            ShowroomVisit.dealership_id == resolved_dealership_id,
            ShowroomVisit.checked_in_at >= activity_date_from,
            ShowroomVisit.checked_in_at <= activity_date_to,
        ]
        if lead_ids:
            check_in_list_filters.append(ShowroomVisit.lead_id.in_(lead_ids))
        check_in_list_q = (
            select(
                ShowroomVisit.id,
                ShowroomVisit.lead_id,
                Customer.first_name,
                Customer.last_name,
                Lead.assigned_to,
                ShowroomVisit.checked_in_at,
                ShowroomVisit.checked_in_by,
                ShowroomVisit.outcome,
            )
            .select_from(ShowroomVisit)
            .join(Lead, Lead.id == ShowroomVisit.lead_id)
            .join(Customer, Customer.id == Lead.customer_id)
            .where(and_(*check_in_list_filters))
            .order_by(ShowroomVisit.checked_in_at.desc())
            .limit(500)
        )
        check_in_list_result = await db.execute(check_in_list_q)
        check_in_rows = check_in_list_result.all()
        # Resolve assigned_to and checked_in_by user names (batch)
        user_id_to_name: dict[UUID, str] = {}
        if check_in_rows:
            assigned_to_ids = list({r.assigned_to for r in check_in_rows if r.assigned_to})
            checked_in_by_ids = list({r.checked_in_by for r in check_in_rows if r.checked_in_by})
            all_user_ids = list(set(assigned_to_ids) | set(checked_in_by_ids))
            if all_user_ids:
                users_result = await db.execute(
                    select(User.id, User.first_name, User.last_name).where(User.id.in_(all_user_ids))
                )
                for u in users_result.all():
                    user_id_to_name[u.id] = f"{u.first_name or ''} {u.last_name or ''}".strip() or str(u.id)
        for r in check_in_rows:
            lead_name = f"{r.first_name or ''} {r.last_name or ''}".strip() or "—"
            check_ins_list.append(
                CheckInRow(
                    visit_id=str(r.id),
                    lead_id=str(r.lead_id),
                    lead_name=lead_name,
                    assigned_to_id=str(r.assigned_to) if r.assigned_to else None,
                    assigned_to_name=user_id_to_name.get(r.assigned_to) if r.assigned_to else None,
                    checked_in_at=r.checked_in_at,
                    checked_in_by_name=user_id_to_name.get(r.checked_in_by) if r.checked_in_by else None,
                    outcome=r.outcome.value if r.outcome else None,
                )
            )

    return DealershipAnalysisResponse(summary=summary, salespeople=salespeople_rows, check_ins=check_ins_list)


@router.get("/analytics/leads-over-time", response_model=LeadsOverTimeResponse)
async def get_leads_over_time(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    dealership_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    source: Optional[str] = Query(None),
    stage_id: Optional[UUID] = Query(None),
    group_by: str = Query("day", description="day or week"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner),
) -> Any:
    """Time-series of leads created and converted per day (or week)."""
    resolved, lead_filters = _resolve_dealership_and_lead_filters(
        current_user, dealership_id, assigned_to, source, stage_id
    )
    if not resolved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dealership context required.")
    base = and_(*lead_filters) if lead_filters else (Lead.dealership_id == resolved)

    date_from_dt = None
    date_to_dt = None
    if date_from:
        try:
            date_from_dt = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
        except ValueError:
            pass
    if date_to:
        try:
            date_to_dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
        except ValueError:
            pass

    created_q = (
        select(func.date(Lead.created_at).label("d"), func.count(Lead.id).label("c"))
        .where(base)
        .where(Lead.created_at.isnot(None))
    )
    if date_from_dt:
        created_q = created_q.where(Lead.created_at >= date_from_dt)
    if date_to_dt:
        created_q = created_q.where(Lead.created_at <= date_to_dt)
    created_q = created_q.group_by(func.date(Lead.created_at)).order_by(func.date(Lead.created_at))
    created_result = await db.execute(created_q)
    created_by_date = {str(row.d): row.c for row in created_result.all()}

    converted_q = (
        select(func.date(Lead.converted_at).label("d"), func.count(Lead.id).label("c"))
        .where(base)
        .where(Lead.outcome == "converted", Lead.converted_at.isnot(None))
    )
    if date_from_dt:
        converted_q = converted_q.where(Lead.converted_at >= date_from_dt)
    if date_to_dt:
        converted_q = converted_q.where(Lead.converted_at <= date_to_dt)
    converted_q = converted_q.group_by(func.date(Lead.converted_at)).order_by(func.date(Lead.converted_at))
    converted_result = await db.execute(converted_q)
    converted_by_date = {str(row.d): row.c for row in converted_result.all()}

    all_dates = sorted(set(created_by_date.keys()) | set(converted_by_date.keys()))
    series = [
        LeadsOverTimeItem(
            date=d,
            leads_created=created_by_date.get(d, 0),
            leads_converted=converted_by_date.get(d, 0),
        )
        for d in all_dates
    ]
    return LeadsOverTimeResponse(series=series)


@router.get("/analytics/leads-by-stage", response_model=LeadsByStageResponse)
async def get_leads_by_stage(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    dealership_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    source: Optional[str] = Query(None),
    stage_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner),
) -> Any:
    """Lead counts grouped by stage."""
    resolved, lead_filters = _resolve_dealership_and_lead_filters(
        current_user, dealership_id, assigned_to, source, stage_id
    )
    if not resolved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dealership context required.")
    base = and_(*lead_filters) if lead_filters else (Lead.dealership_id == resolved)

    q = (
        select(Lead.stage_id, LeadStage.display_name, func.count(Lead.id).label("count"))
        .join(LeadStage, Lead.stage_id == LeadStage.id)
        .where(base)
        .group_by(Lead.stage_id, LeadStage.display_name)
        .order_by(func.count(Lead.id).desc())
    )
    result = await db.execute(q)
    items = [
        LeadsByStageItem(stage_id=str(row.stage_id), stage_name=row.display_name or "", count=row.count)
        for row in result.all()
    ]
    return LeadsByStageResponse(items=items)


@router.get("/analytics/leads-by-source", response_model=LeadsBySourceResponse)
async def get_leads_by_source(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    dealership_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    source: Optional[str] = Query(None),
    stage_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner),
) -> Any:
    """Lead counts grouped by source."""
    resolved, lead_filters = _resolve_dealership_and_lead_filters(
        current_user, dealership_id, assigned_to, source, stage_id
    )
    if not resolved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dealership context required.")
    base = and_(*lead_filters) if lead_filters else (Lead.dealership_id == resolved)

    q = (
        select(Lead.source, func.count(Lead.id).label("count"))
        .where(base)
        .group_by(Lead.source)
        .order_by(func.count(Lead.id).desc())
    )
    result = await db.execute(q)
    items = [
        LeadsBySourceItem(source=row.source.value if hasattr(row.source, "value") else str(row.source), count=row.count)
        for row in result.all()
    ]
    return LeadsBySourceResponse(items=items)


@router.get("/analytics/activities-over-time", response_model=ActivitiesOverTimeResponse)
async def get_activities_over_time(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    dealership_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    source: Optional[str] = Query(None),
    stage_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_owner),
) -> Any:
    """Time-series of activities and notes per day (scoped to dealership and optional lead filters)."""
    resolved, lead_filters = _resolve_dealership_and_lead_filters(
        current_user, dealership_id, assigned_to, source, stage_id
    )
    if not resolved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dealership context required.")
    lead_filters_base = and_(*lead_filters) if lead_filters else (Lead.dealership_id == resolved)
    lead_ids_result = await db.execute(select(Lead.id).where(lead_filters_base))
    lead_ids = [r[0] for r in lead_ids_result.fetchall()]

    activity_filters = [Activity.dealership_id == resolved]
    if lead_ids:
        activity_filters.append(Activity.lead_id.in_(lead_ids))
    date_from_dt = None
    date_to_dt = None
    if date_from:
        try:
            date_from_dt = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
        except ValueError:
            pass
    if date_to:
        try:
            date_to_dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
        except ValueError:
            pass
    if date_from_dt:
        activity_filters.append(Activity.created_at >= date_from_dt)
    if date_to_dt:
        activity_filters.append(Activity.created_at <= date_to_dt)

    all_q = (
        select(func.date(Activity.created_at).label("d"), func.count(Activity.id).label("c"))
        .where(and_(*activity_filters))
        .group_by(func.date(Activity.created_at))
        .order_by(func.date(Activity.created_at))
    )
    all_result = await db.execute(all_q)
    all_by_date = {str(row.d): row.c for row in all_result.all()}

    notes_filters = activity_filters + [Activity.type == ActivityType.NOTE_ADDED]
    notes_q = (
        select(func.date(Activity.created_at).label("d"), func.count(Activity.id).label("c"))
        .where(and_(*notes_filters))
        .group_by(func.date(Activity.created_at))
        .order_by(func.date(Activity.created_at))
    )
    notes_result = await db.execute(notes_q)
    notes_by_date = {str(row.d): row.c for row in notes_result.all()}

    all_dates = sorted(set(all_by_date.keys()) | set(notes_by_date.keys()))
    series = [
        ActivitiesOverTimeItem(
            date=d,
            activities=all_by_date.get(d, 0),
            notes=notes_by_date.get(d, 0),
        )
        for d in all_dates
    ]
    return ActivitiesOverTimeResponse(series=series)
