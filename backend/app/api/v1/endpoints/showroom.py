"""
Showroom Endpoints - Check-in/Check-out for customer tracking
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead, LeadStatus
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
    
    # Fetch lead
    lead_result = await db.execute(select(Lead).where(Lead.id == visit.lead_id))
    lead = lead_result.scalar_one_or_none()
    if lead:
        response["lead"] = {
            "id": lead.id,
            "first_name": lead.first_name,
            "last_name": lead.last_name,
            "phone": lead.phone,
            "email": lead.email,
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
    
    # Update lead status to IN_SHOWROOM
    old_status = lead.status
    lead.status = LeadStatus.IN_SHOWROOM
    
    # Log activity
    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.STATUS_CHANGED,
        description=f"Customer checked into showroom: {lead_name}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=dealership_id,
        meta_data={
            "action": "showroom_check_in",
            "old_status": old_status.value if old_status else None,
            "new_status": "in_showroom",
            "visit_id": str(visit.id),
        }
    )
    
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
    
    # Get lead and update status based on check-out outcome (sync outcome -> lead status)
    lead_result = await db.execute(select(Lead).where(Lead.id == visit.lead_id))
    lead = lead_result.scalar_one_or_none()

    # Map showroom outcome to lead status
    new_status = LeadStatus.CONTACTED  # Default for BROWSING / general
    if check_out_data.outcome == ShowroomOutcome.SOLD:
        new_status = LeadStatus.CONVERTED
    elif check_out_data.outcome == ShowroomOutcome.FOLLOW_UP:
        new_status = LeadStatus.FOLLOW_UP
    elif check_out_data.outcome == ShowroomOutcome.NOT_INTERESTED:
        new_status = LeadStatus.NOT_INTERESTED
    elif check_out_data.outcome == ShowroomOutcome.RESCHEDULE:
        new_status = LeadStatus.FOLLOW_UP
    elif check_out_data.outcome == ShowroomOutcome.BROWSING:
        new_status = LeadStatus.CONTACTED

    if lead:
        old_status = lead.status
        lead.status = new_status
        if new_status == LeadStatus.CONVERTED:
            lead.converted_at = utc_now()

        # Log activity
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
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
                "old_status": old_status.value if old_status else None,
                "new_status": new_status.value,
                "visit_id": str(visit.id),
            }
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
    """
    # Build query for current user's dealership
    query = select(ShowroomVisit).where(
        ShowroomVisit.checked_out_at.is_(None)
    ).order_by(ShowroomVisit.checked_in_at.desc())
    
    # Filter by dealership if not super admin
    from app.core.permissions import UserRole
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        query = query.where(ShowroomVisit.dealership_id == current_user.dealership_id)
    
    result = await db.execute(query)
    visits = result.scalars().all()
    
    enriched_visits = []
    for visit in visits:
        enriched_visits.append(await enrich_visit(db, visit))
    
    return {
        "count": len(enriched_visits),
        "visits": enriched_visits
    }


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
    """
    from app.core.permissions import UserRole
    
    # Build base query
    query = select(ShowroomVisit)
    count_query = select(func.count(ShowroomVisit.id))
    
    # Filter by dealership if not super admin
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        query = query.where(ShowroomVisit.dealership_id == current_user.dealership_id)
        count_query = count_query.where(ShowroomVisit.dealership_id == current_user.dealership_id)
    
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
    visits = result.scalars().all()
    
    enriched_visits = []
    for visit in visits:
        enriched_visits.append(await enrich_visit(db, visit))
    
    return {
        "items": enriched_visits,
        "total": total,
        "page": page,
        "page_size": page_size
    }


@router.get("/stats", response_model=ShowroomStats)
async def get_showroom_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get showroom statistics for dashboard.
    """
    from app.core.permissions import UserRole
    
    # Base filter for dealership
    dealership_filter = []
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id:
        dealership_filter.append(ShowroomVisit.dealership_id == current_user.dealership_id)
    
    # Currently in showroom
    current_query = select(func.count(ShowroomVisit.id)).where(
        ShowroomVisit.checked_out_at.is_(None),
        *dealership_filter
    )
    current_result = await db.execute(current_query)
    currently_in_showroom = current_result.scalar() or 0
    
    # Checked in today
    now = utc_now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_query = select(func.count(ShowroomVisit.id)).where(
        ShowroomVisit.checked_in_at >= start_of_day,
        *dealership_filter
    )
    today_result = await db.execute(today_query)
    checked_in_today = today_result.scalar() or 0
    
    # Sold today
    sold_query = select(func.count(ShowroomVisit.id)).where(
        ShowroomVisit.checked_in_at >= start_of_day,
        ShowroomVisit.outcome == ShowroomOutcome.SOLD,
        *dealership_filter
    )
    sold_result = await db.execute(sold_query)
    sold_today = sold_result.scalar() or 0
    
    # Average visit duration (last 30 days, completed visits only)
    thirty_days_ago = now - timedelta(days=30)
    # Note: PostgreSQL specific for interval calculation
    avg_duration = None
    try:
        from sqlalchemy import extract
        duration_query = select(
            func.avg(
                extract('epoch', ShowroomVisit.checked_out_at - ShowroomVisit.checked_in_at) / 60
            )
        ).where(
            ShowroomVisit.checked_out_at.isnot(None),
            ShowroomVisit.checked_in_at >= thirty_days_ago,
            *dealership_filter
        )
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
