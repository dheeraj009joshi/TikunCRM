"""
Showroom Endpoints - Check-in/Check-out for customer tracking
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead
from app.models.customer import Customer
from app.services.lead_stage_service import LeadStageService
from app.models.appointment import Appointment, AppointmentStatus
from app.models.showroom_visit import ShowroomVisit, ShowroomOutcome
from app.models.activity import ActivityType
from app.services.activity import ActivityService
from app.schemas.showroom import (
    ShowroomCheckIn,
    ShowroomCheckOut,
    ShowroomVisitResponse,
    ShowroomCurrentResponse,
    ShowroomHistoryResponse,
    ShowroomStats,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def enrich_visit(db: AsyncSession, visit: ShowroomVisit) -> dict:
    """Add lead and user info to visit response"""
    response = {
        "id": visit.id,
        "lead_id": visit.lead_id,
        "appointment_id": visit.appointment_id,
        "dealership_id": visit.dealership_id,
        "checked_in_at": visit.checked_in_at,
        "checked_out_at": visit.checked_out_at,
        "checked_in_by": visit.checked_in_by,
        "checked_out_by": visit.checked_out_by,
        "outcome": visit.outcome,
        "notes": visit.notes,
        "is_checked_in": visit.is_checked_in,
        "lead": None,
        "checked_in_by_user": None,
        "checked_out_by_user": None,
        "created_at": visit.created_at,
        "updated_at": visit.updated_at,
    }
    
    # Fetch lead + customer
    lead_result = await db.execute(select(Lead).where(Lead.id == visit.lead_id))
    lead = lead_result.scalar_one_or_none()
    if lead:
        cust = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
        customer = cust.scalar_one_or_none()
        response["lead"] = {
            "id": lead.id,
            "customer": {
                "first_name": customer.first_name if customer else "",
                "last_name": customer.last_name if customer else None,
                "full_name": customer.full_name if customer else "",
                "phone": customer.phone if customer else None,
                "email": customer.email if customer else None,
            } if customer else None,
        }
    
    # Fetch checked_in_by user
    if visit.checked_in_by:
        user_result = await db.execute(select(User).where(User.id == visit.checked_in_by))
        user = user_result.scalar_one_or_none()
        if user:
            response["checked_in_by_user"] = {
                "id": user.id,
                "first_name": user.first_name,
                "last_name": user.last_name,
            }
    
    # Fetch checked_out_by user
    if visit.checked_out_by:
        user_result = await db.execute(select(User).where(User.id == visit.checked_out_by))
        user = user_result.scalar_one_or_none()
        if user:
            response["checked_out_by_user"] = {
                "id": user.id,
                "first_name": user.first_name,
                "last_name": user.last_name,
            }
    
    return response


@router.post("/check-in", response_model=ShowroomVisitResponse, status_code=status.HTTP_201_CREATED)
async def check_in(
    check_in_data: ShowroomCheckIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Check in a customer to the showroom.
    Sets lead status to IN_SHOWROOM.
    """
    # Verify lead exists
    lead_result = await db.execute(select(Lead).where(Lead.id == check_in_data.lead_id))
    lead = lead_result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Check if lead is already checked in
    existing_visit = await db.execute(
        select(ShowroomVisit).where(
            and_(
                ShowroomVisit.lead_id == check_in_data.lead_id,
                ShowroomVisit.checked_out_at.is_(None)
            )
        )
    )
    if existing_visit.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Customer is already checked in")
    
    # Determine dealership (lead's assigned dealership or current user's dealership)
    dealership_id = lead.dealership_id or current_user.dealership_id
    if not dealership_id:
        raise HTTPException(
            status_code=400,
            detail="Assign this lead to a dealership before checking in. Use Edit on the lead to set the dealership, or assign from the Unassigned Pool.",
        )
    
    # Create visit
    visit = ShowroomVisit(
        lead_id=check_in_data.lead_id,
        appointment_id=check_in_data.appointment_id,
        dealership_id=dealership_id,
        checked_in_by=current_user.id,
        notes=check_in_data.notes,
    )
    db.add(visit)
    
    # Update lead stage to IN_SHOWROOM
    from app.models.lead_stage import LeadStage as LS
    old_stage = await LeadStageService.get_stage(db, lead.stage_id)
    old_stage_name = old_stage.display_name if old_stage else "?"
    in_showroom_stage = await LeadStageService.get_stage_by_name(db, "in_showroom", dealership_id)
    if in_showroom_stage:
        lead.stage_id = in_showroom_stage.id

    # Log activity
    cust_r = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
    cust_obj = cust_r.scalar_one_or_none()
    lead_name = cust_obj.full_name if cust_obj else "Customer"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.STATUS_CHANGED,
        description=f"Customer checked into showroom: {lead_name}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=dealership_id,
        meta_data={
            "action": "showroom_check_in",
            "old_status": old_stage_name,
            "new_status": "in_showroom",
            "visit_id": str(visit.id),
        },
    )
    
    # If check-in is linked to an appointment, set appointment status to ARRIVED
    if check_in_data.appointment_id:
        appt_result = await db.execute(
            select(Appointment).where(Appointment.id == check_in_data.appointment_id)
        )
        appointment = appt_result.scalar_one_or_none()
        if appointment and appointment.lead_id == check_in_data.lead_id and appointment.dealership_id == dealership_id:
            appointment.status = AppointmentStatus.ARRIVED
    
    await db.commit()
    await db.refresh(visit)

    # Emit WebSocket events so showroom dashboard and lead list/detail update (status = IN_SHOWROOM)
    try:
        from app.services.notification_service import emit_showroom_update, emit_lead_updated
        await emit_showroom_update(str(dealership_id), "check_in", {
            "visit_id": str(visit.id),
            "lead_id": str(lead.id),
            "lead_name": lead_name,
        })
        await emit_lead_updated(
            str(lead.id),
            str(dealership_id),
            "status_changed",
            {
                "status": "in_showroom",
                "old_status": old_status.value if old_status else None,
                "source": "showroom_check_in",
            },
        )
    except Exception as e:
        logger.warning(f"Failed to emit showroom update: {e}")

    return await enrich_visit(db, visit)


@router.post("/{visit_id}/check-out", response_model=ShowroomVisitResponse)
async def check_out(
    visit_id: UUID,
    check_out_data: ShowroomCheckOut,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Check out a customer from the showroom.
    Updates lead status based on outcome.
    """
    # Find visit
    visit_result = await db.execute(
        select(ShowroomVisit).where(ShowroomVisit.id == visit_id)
    )
    visit = visit_result.scalar_one_or_none()
    
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    
    if visit.checked_out_at:
        raise HTTPException(status_code=400, detail="Customer already checked out")
    
    # Update visit
    visit.checked_out_at = utc_now()
    visit.checked_out_by = current_user.id
    visit.outcome = check_out_data.outcome
    if check_out_data.notes:
        visit.notes = (visit.notes or "") + f"\n\nCheckout: {check_out_data.notes}"
    
    # Get lead and update stage based on check-out outcome
    lead_result = await db.execute(select(Lead).where(Lead.id == visit.lead_id))
    lead = lead_result.scalar_one_or_none()

    # Map showroom outcome to stage name
    outcome_to_stage = {
        ShowroomOutcome.SOLD: "converted",
        ShowroomOutcome.NOT_INTERESTED: "not_interested",
        ShowroomOutcome.FOLLOW_UP: "follow_up",
        ShowroomOutcome.RESCHEDULE: "reschedule",
        ShowroomOutcome.BROWSING: "browsing",
        ShowroomOutcome.COULDNT_QUALIFY: "couldnt_qualify",
    }
    target_stage_name = outcome_to_stage.get(check_out_data.outcome, "contacted")
    target_stage = await LeadStageService.get_stage_by_name(
        db, target_stage_name, visit.dealership_id
    )

    # When outcome is RESCHEDULE and visit has linked appointment, reschedule it
    if (
        check_out_data.outcome == ShowroomOutcome.RESCHEDULE
        and visit.appointment_id
        and check_out_data.reschedule_scheduled_at
    ):
        apt_result = await db.execute(
            select(Appointment).where(Appointment.id == visit.appointment_id)
        )
        appointment = apt_result.scalar_one_or_none()
        if appointment:
            new_at = check_out_data.reschedule_scheduled_at
            if new_at.tzinfo is None:
                new_at = new_at.replace(tzinfo=timezone.utc)
            appointment.scheduled_at = new_at
            appointment.status = AppointmentStatus.SCHEDULED

    if lead and target_stage:
        old_stage = await LeadStageService.get_stage(db, lead.stage_id)
        old_stage_name = old_stage.display_name if old_stage else "?"
        lead.stage_id = target_stage.id

        # Terminal handling
        if target_stage.is_terminal:
            lead.is_active = False
            lead.closed_at = utc_now()
            lead.outcome = target_stage.name
            if target_stage.name == "converted":
                lead.converted_at = utc_now()

        # Log activity
        _co = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
        _cust = _co.scalar_one_or_none()
        lead_name = _cust.full_name if _cust else "Customer"
        outcome_label = check_out_data.outcome.value.replace("_", " ").title()
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.STATUS_CHANGED,
            description=f"Customer checked out of showroom - Outcome: {outcome_label}",
            user_id=current_user.id,
            lead_id=lead.id,
            dealership_id=visit.dealership_id,
            meta_data={
                "action": "showroom_check_out",
                "outcome": check_out_data.outcome.value,
                "old_status": old_stage_name,
                "new_status": target_stage.display_name,
                "visit_id": str(visit.id),
            },
        )

    await db.commit()
    await db.refresh(visit)

    # Emit WebSocket events so showroom dashboard and lead list/dashboards update in real time
    try:
        from app.services.notification_service import emit_showroom_update, emit_lead_updated
        await emit_showroom_update(str(visit.dealership_id), "check_out", {
            "visit_id": str(visit.id),
            "lead_id": str(visit.lead_id),
            "outcome": check_out_data.outcome.value,
        })
        if lead:
            await emit_lead_updated(
                str(lead.id),
                str(visit.dealership_id),
                "status_changed",
                {
                    "status": new_status.value,
                    "old_status": old_status.value if old_status else None,
                    "source": "showroom_check_out",
                    "outcome": check_out_data.outcome.value,
                },
            )
    except Exception as e:
        logger.warning(f"Failed to emit WebSocket events: {e}")

    return await enrich_visit(db, visit)


@router.get("/current", response_model=ShowroomCurrentResponse)
async def get_current_visitors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get customers currently in the showroom.
    Admins/owners see all visits in their dealership; salespersons see only their assigned leads.
    """
    from app.core.permissions import UserRole

    query = select(ShowroomVisit).where(ShowroomVisit.checked_out_at.is_(None))
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        query = query.where(ShowroomVisit.dealership_id == current_user.dealership_id)
    if current_user.role == UserRole.SALESPERSON:
        query = query.join(Lead, ShowroomVisit.lead_id == Lead.id).where(
            Lead.assigned_to == current_user.id
        )
    query = query.order_by(ShowroomVisit.checked_in_at.desc())

    result = await db.execute(query)
    visits = result.unique().scalars().all() if current_user.role == UserRole.SALESPERSON else result.scalars().all()

    enriched_visits = [await enrich_visit(db, v) for v in visits]
    return {"count": len(enriched_visits), "visits": enriched_visits}


@router.get("/history", response_model=ShowroomHistoryResponse)
async def get_visit_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    outcome: Optional[ShowroomOutcome] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get showroom visit history with pagination.
    Admins/owners see all visits in their dealership; salespersons see only their assigned leads.
    """
    from app.core.permissions import UserRole

    query = select(ShowroomVisit)
    count_query = select(func.count(ShowroomVisit.id))
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        query = query.where(ShowroomVisit.dealership_id == current_user.dealership_id)
        count_query = count_query.where(ShowroomVisit.dealership_id == current_user.dealership_id)
    if current_user.role == UserRole.SALESPERSON:
        query = query.join(Lead, ShowroomVisit.lead_id == Lead.id).where(
            Lead.assigned_to == current_user.id
        )
        count_query = count_query.join(Lead, ShowroomVisit.lead_id == Lead.id).where(
            Lead.assigned_to == current_user.id
        )

    # Apply filters
    if date_from:
        query = query.where(ShowroomVisit.checked_in_at >= date_from)
        count_query = count_query.where(ShowroomVisit.checked_in_at >= date_from)
    if date_to:
        query = query.where(ShowroomVisit.checked_in_at <= date_to)
        count_query = count_query.where(ShowroomVisit.checked_in_at <= date_to)
    if outcome:
        query = query.where(ShowroomVisit.outcome == outcome)
        count_query = count_query.where(ShowroomVisit.outcome == outcome)
    
    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Apply pagination and ordering
    query = query.order_by(ShowroomVisit.checked_in_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    visits = result.unique().scalars().all() if current_user.role == UserRole.SALESPERSON else result.scalars().all()

    enriched_visits = [await enrich_visit(db, v) for v in visits]
    return {"items": enriched_visits, "total": total, "page": page, "page_size": page_size}


@router.get("/stats", response_model=ShowroomStats)
async def get_showroom_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get showroom statistics for dashboard.
    Admins/owners see dealership-wide stats; salespersons see only their assigned leads.
    """
    from app.core.permissions import UserRole

    base_filters = [ShowroomVisit.checked_out_at.is_(None)]
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        base_filters.append(ShowroomVisit.dealership_id == current_user.dealership_id)
    if current_user.role == UserRole.SALESPERSON:
        base_filters.append(Lead.assigned_to == current_user.id)

    # Currently in showroom
    current_query = select(func.count(ShowroomVisit.id)).select_from(ShowroomVisit)
    if current_user.role == UserRole.SALESPERSON:
        current_query = current_query.join(Lead, ShowroomVisit.lead_id == Lead.id)
    current_query = current_query.where(and_(*base_filters))
    current_result = await db.execute(current_query)
    currently_in_showroom = current_result.scalar() or 0

    now = utc_now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_filters = [ShowroomVisit.checked_in_at >= start_of_day]
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        today_filters.append(ShowroomVisit.dealership_id == current_user.dealership_id)
    if current_user.role == UserRole.SALESPERSON:
        today_filters.append(Lead.assigned_to == current_user.id)

    today_query = select(func.count(ShowroomVisit.id)).select_from(ShowroomVisit)
    if current_user.role == UserRole.SALESPERSON:
        today_query = today_query.join(Lead, ShowroomVisit.lead_id == Lead.id)
    today_query = today_query.where(and_(*today_filters))
    today_result = await db.execute(today_query)
    checked_in_today = today_result.scalar() or 0

    sold_filters = [
        ShowroomVisit.checked_in_at >= start_of_day,
        ShowroomVisit.outcome == ShowroomOutcome.SOLD,
    ]
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        sold_filters.append(ShowroomVisit.dealership_id == current_user.dealership_id)
    if current_user.role == UserRole.SALESPERSON:
        sold_filters.append(Lead.assigned_to == current_user.id)
    sold_query = select(func.count(ShowroomVisit.id)).select_from(ShowroomVisit)
    if current_user.role == UserRole.SALESPERSON:
        sold_query = sold_query.join(Lead, ShowroomVisit.lead_id == Lead.id)
    sold_query = sold_query.where(and_(*sold_filters))
    sold_result = await db.execute(sold_query)
    sold_today = sold_result.scalar() or 0

    thirty_days_ago = now - timedelta(days=30)
    avg_duration = None
    try:
        from sqlalchemy import extract
        duration_filters = [
            ShowroomVisit.checked_out_at.isnot(None),
            ShowroomVisit.checked_in_at >= thirty_days_ago,
        ]
        if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
            duration_filters.append(ShowroomVisit.dealership_id == current_user.dealership_id)
        if current_user.role == UserRole.SALESPERSON:
            duration_filters.append(Lead.assigned_to == current_user.id)
        duration_query = select(
            func.avg(
                extract("epoch", ShowroomVisit.checked_out_at - ShowroomVisit.checked_in_at) / 60
            )
        ).select_from(ShowroomVisit)
        if current_user.role == UserRole.SALESPERSON:
            duration_query = duration_query.join(Lead, ShowroomVisit.lead_id == Lead.id)
        duration_query = duration_query.where(and_(*duration_filters))
        duration_result = await db.execute(duration_query)
        avg_duration = duration_result.scalar()
    except Exception as e:
        logger.warning(f"Failed to calculate avg duration: {e}")

    return {
        "currently_in_showroom": currently_in_showroom,
        "checked_in_today": checked_in_today,
        "sold_today": sold_today,
        "avg_visit_duration_minutes": round(avg_duration, 1) if avg_duration else None
    }
