"""
Follow-Up Endpoints
"""
import math
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, desc, func, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.models.activity import ActivityType
from app.schemas.follow_up import FollowUpResponse, FollowUpCreate, FollowUpUpdate, FollowUpListResponse
from app.schemas.lead import LeadBrief
from app.schemas.customer import CustomerBrief
from app.schemas.user import UserBrief
from app.models.customer import Customer
from app.services.activity import ActivityService
from app.services.notification_service import NotificationService, send_skate_alert_background, emit_stats_refresh
from app.utils.skate_helper import check_skate_condition

router = APIRouter()


@router.get("/", response_model=FollowUpListResponse)
async def list_follow_ups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    lead_id: Optional[UUID] = Query(None, description="Filter by lead"),
    assigned_to: Optional[UUID] = Query(None, description="Filter by assigned user (admin/owner only)"),
    status: Optional[FollowUpStatus] = None,
    overdue: bool = False,
    date_from: Optional[datetime] = Query(None, description="Filter by scheduled_at >= date_from"),
    date_to: Optional[datetime] = Query(None, description="Filter by scheduled_at <= date_to"),
) -> Any:
    """
    List follow-ups for the current user or dealership with pagination.
    Optionally filter by lead_id (e.g. for lead detail page) or assigned_to (e.g. for salesperson report).
    When lead_id is provided, returns all follow-ups for that lead (including past/completed) for users who can view the lead.
    """
    # Base query for building filters
    base_filters = []
    user_join_needed = False
    
    # When filtering by lead: verify lead access
    if lead_id is not None:
        lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
        lead = lead_result.scalar_one_or_none()
        if not lead:
            return FollowUpListResponse(items=[], total=0, page=page, page_size=page_size, total_pages=0, stats={"total": 0, "pending": 0, "overdue": 0, "completed": 0})
        is_unassigned_pool = lead.dealership_id is None
        if is_unassigned_pool:
            has_access = current_user.role == UserRole.SUPER_ADMIN or current_user.dealership_id is not None
        else:
            has_access = (
                current_user.role == UserRole.SUPER_ADMIN
                or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
                or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
            )
        if not has_access:
            return FollowUpListResponse(items=[], total=0, page=page, page_size=page_size, total_pages=0, stats={"total": 0, "pending": 0, "overdue": 0, "completed": 0})
        base_filters.append(FollowUp.lead_id == lead_id)
    else:
        # RBAC Isolation (when not filtering by specific lead)
        if current_user.role == UserRole.SALESPERSON:
            base_filters.append(FollowUp.assigned_to == current_user.id)
        elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
            user_join_needed = True
    
    if assigned_to is not None:
        base_filters.append(FollowUp.assigned_to == assigned_to)
    
    # Date range filters
    if date_from:
        base_filters.append(FollowUp.scheduled_at >= date_from)
    if date_to:
        base_filters.append(FollowUp.scheduled_at <= date_to)
        
    if status:
        base_filters.append(FollowUp.status == status)
    
    if overdue:
        base_filters.append(FollowUp.scheduled_at < utc_now())
        base_filters.append(FollowUp.status == FollowUpStatus.PENDING)
    
    # Build count query for stats (without status/overdue filters to get all counts)
    stats_filters = [f for f in base_filters if not (
        (hasattr(f, 'left') and hasattr(f.left, 'key') and f.left.key == 'status') or
        (status and f == (FollowUp.status == status)) or
        (overdue and f == (FollowUp.scheduled_at < utc_now()))
    )]
    # Remove status and overdue filters for stats calculation
    stats_base_filters = []
    for f in base_filters:
        # Skip status filter
        try:
            if hasattr(f, 'right') and f.right == status:
                continue
        except:
            pass
        # Skip overdue filters
        if overdue:
            try:
                if hasattr(f, 'right') and f.right == FollowUpStatus.PENDING:
                    continue
            except:
                pass
        stats_base_filters.append(f)
    
    # Calculate stats using separate queries for accuracy
    stats_query_base = select(FollowUp)
    if user_join_needed:
        stats_query_base = stats_query_base.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    
    # Apply only RBAC and date filters for stats (not status/overdue)
    rbac_date_filters = []
    if lead_id is not None:
        rbac_date_filters.append(FollowUp.lead_id == lead_id)
    elif current_user.role == UserRole.SALESPERSON:
        rbac_date_filters.append(FollowUp.assigned_to == current_user.id)
    if assigned_to is not None:
        rbac_date_filters.append(FollowUp.assigned_to == assigned_to)
    if date_from:
        rbac_date_filters.append(FollowUp.scheduled_at >= date_from)
    if date_to:
        rbac_date_filters.append(FollowUp.scheduled_at <= date_to)
    
    # Total count
    total_count_query = select(func.count(FollowUp.id))
    if user_join_needed:
        total_count_query = total_count_query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    if rbac_date_filters:
        total_count_query = total_count_query.where(and_(*rbac_date_filters))
    total_result = await db.execute(total_count_query)
    stats_total = total_result.scalar() or 0
    
    # Pending count
    pending_filters = rbac_date_filters + [FollowUp.status == FollowUpStatus.PENDING]
    pending_count_query = select(func.count(FollowUp.id))
    if user_join_needed:
        pending_count_query = pending_count_query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    pending_count_query = pending_count_query.where(and_(*pending_filters))
    pending_result = await db.execute(pending_count_query)
    stats_pending = pending_result.scalar() or 0
    
    # Overdue count
    overdue_filters = rbac_date_filters + [FollowUp.status == FollowUpStatus.PENDING, FollowUp.scheduled_at < utc_now()]
    overdue_count_query = select(func.count(FollowUp.id))
    if user_join_needed:
        overdue_count_query = overdue_count_query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    overdue_count_query = overdue_count_query.where(and_(*overdue_filters))
    overdue_result = await db.execute(overdue_count_query)
    stats_overdue = overdue_result.scalar() or 0
    
    # Completed count
    completed_filters = rbac_date_filters + [FollowUp.status == FollowUpStatus.COMPLETED]
    completed_count_query = select(func.count(FollowUp.id))
    if user_join_needed:
        completed_count_query = completed_count_query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    completed_count_query = completed_count_query.where(and_(*completed_filters))
    completed_result = await db.execute(completed_count_query)
    stats_completed = completed_result.scalar() or 0
    
    stats = {
        "total": stats_total,
        "pending": stats_pending,
        "overdue": stats_overdue,
        "completed": stats_completed
    }
    
    # Build main query with all filters for pagination
    query = select(FollowUp).options(
        selectinload(FollowUp.lead),
        selectinload(FollowUp.assigned_to_user)
    )
    
    if user_join_needed:
        query = query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    
    if base_filters:
        query = query.where(and_(*base_filters))
    
    # Get total count for current filter set (for pagination)
    count_query = select(func.count(FollowUp.id))
    if user_join_needed:
        count_query = count_query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    if base_filters:
        count_query = count_query.where(and_(*base_filters))
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0
    total_pages = math.ceil(total / page_size) if total > 0 else 0
    
    # Apply ordering and pagination
    offset = (page - 1) * page_size
    query = query.order_by(FollowUp.scheduled_at.asc()).offset(offset).limit(page_size)
    
    result = await db.execute(query)
    follow_ups = result.scalars().all()
    
    # Enrich with lead and user info
    enriched = []
    for follow_up in follow_ups:
        follow_up_dict = {
            **follow_up.__dict__,
            "lead": {
                "id": str(follow_up.lead.id),
                "customer": {
                    "id": str(follow_up.lead.customer_id),
                    "first_name": follow_up.lead.first_name,
                    "last_name": follow_up.lead.last_name,
                    "phone": follow_up.lead.phone,
                    "email": follow_up.lead.email,
                } if follow_up.lead else None,
                "source": follow_up.lead.source.value if follow_up.lead else None,
                "is_active": follow_up.lead.is_active if follow_up.lead else True,
            } if follow_up.lead else None,
            "assigned_to_user": UserBrief(
                id=follow_up.assigned_to_user.id,
                email=follow_up.assigned_to_user.email,
                first_name=follow_up.assigned_to_user.first_name,
                last_name=follow_up.assigned_to_user.last_name,
                role=follow_up.assigned_to_user.role,
                is_active=follow_up.assigned_to_user.is_active,
                dealership_id=follow_up.assigned_to_user.dealership_id,
                smtp_email=follow_up.assigned_to_user.smtp_email,
                email_config_verified=follow_up.assigned_to_user.email_config_verified
            ) if follow_up.assigned_to_user else None
        }
        enriched.append(FollowUpResponse(**follow_up_dict))
    
    return FollowUpListResponse(
        items=enriched,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        stats=stats
    )


@router.post("/{lead_id}", response_model=FollowUpResponse)
async def schedule_follow_up(
    lead_id: UUID,
    follow_up_in: FollowUpCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Schedule a new follow-up for a lead.
    """
    # Verify lead exists and user has access
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Soft SKATE check: check if this is a SKATE scenario
    skate_info = await check_skate_condition(db, current_user, lead, "schedule follow-up")
    is_skate_action = False
    
    if skate_info:
        if not follow_up_in.confirm_skate:
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
                    lead_id=lead_id,
                    lead_name=skate_info["lead_name"],
                    dealership_id=dealership_id,
                    assigned_to_user_id=lead.assigned_to,
                    assigned_to_name=skate_info["assigned_to_name"],
                    performer_name=performer_name,
                    action="scheduled a follow-up",
                    performer_user_id=current_user.id,
                )

    # RBAC: Check if user has access to this lead
    if current_user.role == UserRole.SALESPERSON:
        # Salesperson can schedule for any lead in their dealership (with SKATE warning above)
        if lead.dealership_id != current_user.dealership_id and lead.dealership_id is not None:
            raise HTTPException(status_code=403, detail="You can only schedule follow-ups for leads in your dealership")
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        # Dealership admin/owner can schedule for leads in their dealership
        if lead.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="You can only schedule follow-ups for leads in your dealership")
    # Super Admin has access to all leads

    # Assignment: explicit from request, else lead's primary salesperson, else current user
    assigned_to_id = follow_up_in.assigned_to
    if not assigned_to_id and lead.assigned_to:
        assigned_to_id = lead.assigned_to
    if not assigned_to_id:
        assigned_to_id = current_user.id

    follow_up = FollowUp(
        lead_id=lead_id,
        assigned_to=assigned_to_id,
        scheduled_at=follow_up_in.scheduled_at,
        notes=follow_up_in.notes,
        status=FollowUpStatus.PENDING
    )
    
    db.add(follow_up)
    await db.flush()
    
    # Log activity
    description = f"Follow-up scheduled for {follow_up_in.scheduled_at.strftime('%Y-%m-%d %H:%M')}"
    if is_skate_action:
        description = f"[SKATE] {description}"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.FOLLOW_UP_SCHEDULED,
        description=description,
        user_id=current_user.id,
        lead_id=lead_id,
        dealership_id=lead.dealership_id,
        meta_data={"scheduled_at": follow_up_in.scheduled_at.isoformat(), "is_skate_action": is_skate_action}
    )
    
    await db.commit()
    
    try:
        await emit_stats_refresh(str(lead.dealership_id) if lead.dealership_id else None)
    except Exception:
        pass
    
    # Re-fetch with relationships loaded
    result = await db.execute(
        select(FollowUp)
        .options(selectinload(FollowUp.lead), selectinload(FollowUp.assigned_to_user))
        .where(FollowUp.id == follow_up.id)
    )
    follow_up = result.scalar_one()

    # Enrich response (schedule)
    follow_up_dict = {
        **follow_up.__dict__,
        "lead": {
            "id": str(follow_up.lead.id),
            "customer": {"id": str(follow_up.lead.customer_id), "first_name": follow_up.lead.first_name, "last_name": follow_up.lead.last_name, "phone": follow_up.lead.phone, "email": follow_up.lead.email} if follow_up.lead else None,
            "source": follow_up.lead.source.value if follow_up.lead else None,
            "is_active": follow_up.lead.is_active if follow_up.lead else True,
        } if follow_up.lead else None,
        "assigned_to_user": UserBrief(
            id=follow_up.assigned_to_user.id,
            email=follow_up.assigned_to_user.email,
            first_name=follow_up.assigned_to_user.first_name,
            last_name=follow_up.assigned_to_user.last_name,
            role=follow_up.assigned_to_user.role,
            is_active=follow_up.assigned_to_user.is_active,
            dealership_id=follow_up.assigned_to_user.dealership_id,
            smtp_email=follow_up.assigned_to_user.smtp_email,
            email_config_verified=follow_up.assigned_to_user.email_config_verified
        ) if follow_up.assigned_to_user else None
    }
    
    return FollowUpResponse(**follow_up_dict)


class FollowUpCompleteRequest(BaseModel):
    """Request body for completing a follow-up"""
    notes: Optional[str] = None


@router.post("/{follow_up_id}/complete", response_model=FollowUpResponse)
async def complete_follow_up(
    follow_up_id: UUID,
    request: Optional[FollowUpCompleteRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Mark a follow-up as completed.
    """
    result = await db.execute(
        select(FollowUp)
        .options(selectinload(FollowUp.lead), selectinload(FollowUp.assigned_to_user))
        .where(FollowUp.id == follow_up_id)
    )
    follow_up = result.scalar_one_or_none()
    
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")
        
    if follow_up.assigned_to != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
         raise HTTPException(status_code=403, detail="Not authorized")
         
    completion_notes = request.notes if request else None
    follow_up.status = FollowUpStatus.COMPLETED
    follow_up.completed_at = utc_now()
    follow_up.completion_notes = completion_notes
    
    await db.flush()
    
    # Get lead for dealership_id context
    lead_result = await db.execute(select(Lead).where(Lead.id == follow_up.lead_id))
    lead = lead_result.scalar_one()
    
    # Log activity
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.FOLLOW_UP_COMPLETED,
        description="Follow-up completed",
        user_id=current_user.id,
        lead_id=follow_up.lead_id,
        dealership_id=lead.dealership_id,
        meta_data={"completion_notes": completion_notes}
    )
    
    await db.commit()
    
    try:
        await emit_stats_refresh(str(lead.dealership_id) if lead.dealership_id else None)
    except Exception:
        pass
    
    # Enrich response (complete)
    follow_up_dict = {
        **follow_up.__dict__,
        "lead": {
            "id": str(follow_up.lead.id),
            "customer": {"id": str(follow_up.lead.customer_id), "first_name": follow_up.lead.first_name, "last_name": follow_up.lead.last_name, "phone": follow_up.lead.phone, "email": follow_up.lead.email} if follow_up.lead else None,
            "source": follow_up.lead.source.value if follow_up.lead else None,
            "is_active": follow_up.lead.is_active if follow_up.lead else True,
        } if follow_up.lead else None,
        "assigned_to_user": UserBrief(
            id=follow_up.assigned_to_user.id,
            email=follow_up.assigned_to_user.email,
            first_name=follow_up.assigned_to_user.first_name,
            last_name=follow_up.assigned_to_user.last_name,
            role=follow_up.assigned_to_user.role,
            is_active=follow_up.assigned_to_user.is_active,
            dealership_id=follow_up.assigned_to_user.dealership_id,
            smtp_email=follow_up.assigned_to_user.smtp_email,
            email_config_verified=follow_up.assigned_to_user.email_config_verified
        ) if follow_up.assigned_to_user else None
    }
    
    return FollowUpResponse(**follow_up_dict)


@router.patch("/{follow_up_id}", response_model=FollowUpResponse)
async def update_follow_up(
    follow_up_id: UUID,
    update_data: FollowUpUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update a follow-up (scheduled_at, notes, status).
    """
    result = await db.execute(
        select(FollowUp)
        .options(selectinload(FollowUp.lead), selectinload(FollowUp.assigned_to_user))
        .where(FollowUp.id == follow_up_id)
    )
    follow_up = result.scalar_one_or_none()
    
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    
    # Authorization: Only assigned user, dealership admin/owner, or super admin can edit
    if current_user.role == UserRole.SALESPERSON:
        if follow_up.assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to edit this follow-up")
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if follow_up.assigned_to_user and follow_up.assigned_to_user.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized to edit this follow-up")
    # Super Admin can edit any follow-up
    
    # Track what changed for activity log
    changes = []
    
    if update_data.scheduled_at is not None and update_data.scheduled_at != follow_up.scheduled_at:
        changes.append(f"rescheduled to {update_data.scheduled_at.strftime('%Y-%m-%d %H:%M')}")
        follow_up.scheduled_at = update_data.scheduled_at
    
    if update_data.notes is not None and update_data.notes != follow_up.notes:
        changes.append("notes updated")
        follow_up.notes = update_data.notes
    
    if update_data.status is not None and update_data.status != follow_up.status:
        changes.append(f"status changed to {update_data.status.value}")
        follow_up.status = update_data.status
        if update_data.status == FollowUpStatus.COMPLETED:
            follow_up.completed_at = utc_now()
    
    if update_data.completion_notes is not None:
        follow_up.completion_notes = update_data.completion_notes
    
    if changes:
        await db.flush()
        
        # Get lead for dealership_id context
        lead_result = await db.execute(select(Lead).where(Lead.id == follow_up.lead_id))
        lead = lead_result.scalar_one()
        
        # Log activity
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.FOLLOW_UP_SCHEDULED,
            description=f"Follow-up updated: {', '.join(changes)}",
            user_id=current_user.id,
            lead_id=follow_up.lead_id,
            dealership_id=lead.dealership_id,
            meta_data={"changes": changes}
        )
        
        await db.commit()
        
        try:
            await emit_stats_refresh(str(lead.dealership_id) if lead.dealership_id else None)
        except Exception:
            pass
    
    # Re-fetch with relationships loaded
    result = await db.execute(
        select(FollowUp)
        .options(selectinload(FollowUp.lead), selectinload(FollowUp.assigned_to_user))
        .where(FollowUp.id == follow_up.id)
    )
    follow_up = result.scalar_one()
    
    # Enrich response
    follow_up_dict = {
        **follow_up.__dict__,
        "lead": {
            "id": str(follow_up.lead.id),
            "customer": {
                "id": str(follow_up.lead.customer_id),
                "first_name": follow_up.lead.first_name,
                "last_name": follow_up.lead.last_name,
                "phone": follow_up.lead.phone,
                "email": follow_up.lead.email,
            } if follow_up.lead else None,
            "source": follow_up.lead.source.value if follow_up.lead else None,
            "is_active": follow_up.lead.is_active if follow_up.lead else True,
        } if follow_up.lead else None,
        "assigned_to_user": UserBrief(
            id=follow_up.assigned_to_user.id,
            email=follow_up.assigned_to_user.email,
            first_name=follow_up.assigned_to_user.first_name,
            last_name=follow_up.assigned_to_user.last_name,
            role=follow_up.assigned_to_user.role,
            is_active=follow_up.assigned_to_user.is_active,
            dealership_id=follow_up.assigned_to_user.dealership_id,
            smtp_email=follow_up.assigned_to_user.smtp_email,
            email_config_verified=follow_up.assigned_to_user.email_config_verified
        ) if follow_up.assigned_to_user else None
    }
    
    return FollowUpResponse(**follow_up_dict)


@router.delete("/{follow_up_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_follow_up(
    follow_up_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
):
    """
    Delete a follow-up.
    """
    result = await db.execute(select(FollowUp).where(FollowUp.id == follow_up_id))
    follow_up = result.scalar_one_or_none()
    
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")
        
    if follow_up.assigned_to != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
         raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.delete(follow_up)
    await db.commit()
