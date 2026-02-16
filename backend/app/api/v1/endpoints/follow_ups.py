"""
Follow-Up Endpoints
"""
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, desc
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
from app.schemas.follow_up import FollowUpResponse, FollowUpCreate, FollowUpUpdate
from app.schemas.lead import LeadBrief
from app.schemas.customer import CustomerBrief
from app.schemas.user import UserBrief
from app.models.customer import Customer
from app.services.activity import ActivityService
from app.services.notification_service import NotificationService, send_skate_alert_background, emit_stats_refresh
from app.utils.skate_helper import check_skate_condition

router = APIRouter()


@router.get("/", response_model=List[FollowUpResponse])
async def list_follow_ups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    lead_id: Optional[UUID] = Query(None, description="Filter by lead"),
    assigned_to: Optional[UUID] = Query(None, description="Filter by assigned user (admin/owner only)"),
    status: Optional[FollowUpStatus] = None,
    overdue: bool = False
) -> Any:
    """
    List follow-ups for the current user or dealership.
    Optionally filter by lead_id (e.g. for lead detail page) or assigned_to (e.g. for salesperson report).
    """
    query = select(FollowUp).options(
        selectinload(FollowUp.lead),
        selectinload(FollowUp.assigned_to_user)
    )
    
    # RBAC Isolation
    if current_user.role == UserRole.SALESPERSON:
        query = query.where(FollowUp.assigned_to == current_user.id)
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        # Show follow-ups whose assignee is in the same dealership (explicit join on assigned_to)
        query = query.join(User, FollowUp.assigned_to == User.id).where(
            User.dealership_id == current_user.dealership_id
        )
    
    if assigned_to is not None:
        query = query.where(FollowUp.assigned_to == assigned_to)
        
    if lead_id is not None:
        query = query.where(FollowUp.lead_id == lead_id)
        
    if status:
        query = query.where(FollowUp.status == status)
    
    if overdue:
        query = query.where(
            FollowUp.scheduled_at < utc_now(),
            FollowUp.status == FollowUpStatus.PENDING
        )
        
    query = query.order_by(FollowUp.scheduled_at.asc())
    
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
    
    return enriched


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
