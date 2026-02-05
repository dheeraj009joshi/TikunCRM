"""
Lead Endpoints
"""
import logging
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead, LeadStatus, LeadSource
from app.models.activity import ActivityType
from app.models.dealership import Dealership
from app.schemas.lead import (
    LeadResponse, LeadCreate, LeadUpdate, LeadDetail, 
    LeadStatusUpdate, LeadAssignment, LeadListResponse,
    LeadDealershipAssignment, BulkLeadDealershipAssignment
)
from app.schemas.activity import NoteCreate
from app.services.activity import ActivityService
from app.services.notification_service import (
    NotificationService,
    send_skate_alert_background,
    notify_lead_assigned_to_dealership_background,
)
from app.utils.skate_helper import check_skate_condition, check_note_skate_condition


# Request schemas for call/email logging
class CallLogCreate(BaseModel):
    """Schema for logging a call"""
    duration_seconds: Optional[int] = None
    outcome: str
    notes: Optional[str] = None
    confirm_skate: bool = False  # If True, user confirmed they want to proceed despite SKATE warning


class EmailLogCreate(BaseModel):
    """Schema for logging an email"""
    subject: str
    body: Optional[str] = None
    direction: str = "sent"  # sent or received
    confirm_skate: bool = False  # If True, user confirmed they want to proceed despite SKATE warning


router = APIRouter()


async def auto_assign_lead_on_activity(
    db: AsyncSession,
    lead: Lead,
    user: User,
    activity_type: str,
    notification_service = None
) -> bool:
    """
    Auto-assign a lead to a user when they perform the first activity.
    
    Rules:
    - Lead has no assigned_to (no salesperson assigned)
    - Either: lead is in global pool (no dealership) OR lead is in user's dealership
    - User must have a dealership_id
    - On first activity, lead is assigned to the user (and their dealership if not already set)
    
    Returns True if auto-assignment occurred, False otherwise.
    """
    # Lead already has a salesperson assigned - no auto-assign needed
    if lead.assigned_to is not None:
        return False
    
    # User must have a dealership to claim a lead
    if not user.dealership_id:
        return False
    
    # Check if lead is either in global pool OR in the user's dealership
    lead_in_global_pool = lead.dealership_id is None
    lead_in_user_dealership = lead.dealership_id == user.dealership_id
    
    if not (lead_in_global_pool or lead_in_user_dealership):
        # Lead is in a different dealership - user can't claim it
        return False
    
    # Perform the auto-assignment
    lead.assigned_to = user.id
    dealership_just_assigned = lead.dealership_id is None
    if lead.dealership_id is None:
        lead.dealership_id = user.dealership_id  # Also assign to dealership if in global pool
    lead.last_activity_at = utc_now()
    
    performer_name = f"{user.first_name} {user.last_name}"
    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "Lead"
    
    # Log auto-assignment activity
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_ASSIGNED,
        description=f"Lead auto-assigned to {performer_name} based on first {activity_type}",
        user_id=user.id,
        lead_id=lead.id,
        dealership_id=user.dealership_id,
        meta_data={
            "auto_assigned": True,
            "reason": "first_activity",
            "activity_type": activity_type,
            "performer_name": performer_name
        }
    )
    
    # When lead was in global pool and is now assigned to dealership, notify all dealership members
    if dealership_just_assigned and notification_service:
        try:
            await notification_service.notify_lead_assigned_to_dealership(
                lead_id=lead.id,
                lead_name=lead_name,
                dealership_id=user.dealership_id,
                performer_name=performer_name,
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("notify_lead_assigned_to_dealership failed: %s", e)
    
    # Notify the user they were assigned
    if notification_service:
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
        await notification_service.notify_lead_assigned(
            user_id=user.id,
            lead_name=lead_name,
            lead_id=lead.id,
            assigned_by="System (auto-assignment)"
        )
    
    # Emit WebSocket event so Lead Context (DEALERSHIP, ASSIGNED TO) auto-updates on open pages
    try:
        from app.services.notification_service import emit_lead_updated
        await emit_lead_updated(
            str(lead.id),
            str(user.dealership_id),
            "assigned",
            {
                "assigned_to": str(user.id),
                "dealership_id": str(user.dealership_id),
                "auto_assigned": True,
            }
        )
    except Exception:
        pass  # Don't fail auto-assign if WebSocket fails
    
    return True


async def enrich_leads_with_relations(db: AsyncSession, leads: list) -> list:
    """Add assigned_to_user and dealership info to leads."""
    if not leads:
        return []
    
    # Collect all user IDs and dealership IDs
    user_ids = set()
    dealership_ids = set()
    for lead in leads:
        if lead.assigned_to:
            user_ids.add(lead.assigned_to)
        if lead.dealership_id:
            dealership_ids.add(lead.dealership_id)
    
    # Fetch users
    users_map = {}
    if user_ids:
        user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for user in user_result.scalars().all():
            users_map[user.id] = {
                "id": str(user.id),
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "role": user.role.value if hasattr(user.role, 'value') else str(user.role),
                "is_active": user.is_active,
                "dealership_id": str(user.dealership_id) if user.dealership_id else None
            }
    
    # Fetch dealerships
    dealerships_map = {}
    if dealership_ids:
        dealership_result = await db.execute(select(Dealership).where(Dealership.id.in_(dealership_ids)))
        for dealership in dealership_result.scalars().all():
            dealerships_map[dealership.id] = {
                "id": str(dealership.id),
                "name": dealership.name
            }
    
    # Build enriched response
    enriched_items = []
    for lead in leads:
        lead_dict = {
            "id": str(lead.id),
            "first_name": lead.first_name,
            "last_name": lead.last_name,
            "email": lead.email,
            "phone": lead.phone,
            "alternate_phone": lead.alternate_phone,
            "source": lead.source.value if hasattr(lead.source, 'value') else str(lead.source),
            "status": lead.status.value if hasattr(lead.status, 'value') else str(lead.status),
            "dealership_id": str(lead.dealership_id) if lead.dealership_id else None,
            "assigned_to": str(lead.assigned_to) if lead.assigned_to else None,
            "created_by": str(lead.created_by) if lead.created_by else None,
            "notes": lead.notes,
            "meta_data": lead.meta_data or {},
            "interested_in": lead.interested_in,
            "budget_range": lead.budget_range,
            "first_contacted_at": lead.first_contacted_at.isoformat() if lead.first_contacted_at else None,
            "last_contacted_at": lead.last_contacted_at.isoformat() if lead.last_contacted_at else None,
            "converted_at": lead.converted_at.isoformat() if lead.converted_at else None,
            "created_at": lead.created_at.isoformat() if lead.created_at else None,
            "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
            "assigned_to_user": users_map.get(lead.assigned_to) if lead.assigned_to else None,
            "dealership": dealerships_map.get(lead.dealership_id) if lead.dealership_id else None
        }
        enriched_items.append(lead_dict)
    
    return enriched_items


@router.get("/")
async def list_leads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[LeadStatus] = None,
    source: Optional[LeadSource] = None,
    search: Optional[str] = None,
    pool: Optional[str] = None  # "unassigned" | "mine" | None (all)
) -> Any:
    """
    List leads with filtering and pagination.
    
    Role-based filtering:
    - Super Admin: sees all leads
    - Dealership Admin/Owner: sees all leads in their dealership
    - Salesperson: sees all leads in their dealership (with SKATE protection)
    
    pool parameter:
    - "unassigned": leads with no salesperson assigned (or no dealership for super admin)
    - "mine": leads assigned to the current user only
    - None (default): all leads visible to the user based on role
    """
    query = select(Lead)
    
    # Handle pool filters first as they override role-based filtering
    if pool == "mine":
        # Show only leads assigned to the current user
        query = query.where(Lead.assigned_to == current_user.id)
        
    elif pool == "unassigned":
        if current_user.role == UserRole.SUPER_ADMIN:
            # Super Admin: show leads with no dealership (for dealership assignment)
            query = query.where(Lead.dealership_id.is_(None))
        elif current_user.dealership_id:
            # Dealership users: show leads in their dealership but no salesperson assigned
            query = query.where(
                and_(
                    Lead.dealership_id == current_user.dealership_id,
                    Lead.assigned_to.is_(None)
                )
            )
        else:
            query = query.where(Lead.id.is_(None))  # Returns empty if no dealership
            
    else:
        # Default: Apply role-based filtering for "all" leads view
        if current_user.role == UserRole.SALESPERSON:
            # Salesperson sees ALL leads in their dealership (including those assigned to others)
            # SKATE warnings will prompt when attempting actions on others' leads
            if current_user.dealership_id:
                query = query.where(Lead.dealership_id == current_user.dealership_id)
            else:
                query = query.where(Lead.id.is_(None))  # Returns empty if no dealership
            
        elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
            # Dealership admins/owners see all leads in their dealership
            if current_user.dealership_id:
                query = query.where(Lead.dealership_id == current_user.dealership_id)
            else:
                # Admin/owner without dealership shouldn't see any leads
                query = query.where(Lead.id.is_(None))  # Returns empty
        # Super admin sees all (no filter)
    
    # Filters
    if status:
        query = query.where(Lead.status == status)
    if source:
        query = query.where(Lead.source == source)
    if search:
        search_filter = or_(
            Lead.first_name.ilike(f"%{search}%"),
            Lead.last_name.ilike(f"%{search}%"),
            Lead.email.ilike(f"%{search}%"),
            Lead.phone.ilike(f"%{search}%")
        )
        query = query.where(search_filter)
        
    # Pagination
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    query = query.order_by(Lead.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    # Enrich with user and dealership info
    enriched_items = await enrich_leads_with_relations(db, items)
    
    return {
        "items": enriched_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size
    }


@router.get("/unassigned")
async def list_unassigned_leads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_ALL_LEADS)),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    source: Optional[LeadSource] = None,
    search: Optional[str] = None
) -> Any:
    """
    Get leads not yet assigned to any dealership (Super Admin only).
    These are leads in the unassigned pool waiting for dealership assignment.
    """
    query = select(Lead).where(Lead.dealership_id.is_(None))
    
    # Filters
    if source:
        query = query.where(Lead.source == source)
    if search:
        search_filter = or_(
            Lead.first_name.ilike(f"%{search}%"),
            Lead.last_name.ilike(f"%{search}%"),
            Lead.email.ilike(f"%{search}%"),
            Lead.phone.ilike(f"%{search}%")
        )
        query = query.where(search_filter)
        
    # Pagination
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    query = query.order_by(Lead.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    # Enrich with user and dealership info
    enriched_items = await enrich_leads_with_relations(db, items)
    
    return {
        "items": enriched_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size
    }


@router.get("/unassigned-to-salesperson")
async def list_leads_unassigned_to_salesperson(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None
) -> Any:
    """
    Get leads assigned to a dealership but not yet assigned to a salesperson.
    For Dealership Admin to assign to their team.
    """
    # Build base query - leads with dealership but no salesperson
    query = select(Lead).where(
        and_(
            Lead.dealership_id.isnot(None),
            Lead.assigned_to.is_(None)
        )
    )
    
    # Role-based filtering - all dealership users can see leads in their dealership without salesperson
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER, UserRole.SALESPERSON]:
        if current_user.dealership_id:
            query = query.where(Lead.dealership_id == current_user.dealership_id)
        else:
            # User without dealership shouldn't see anything
            query = query.where(Lead.id.is_(None))  # Returns empty
    # Super Admin can see all
    
    if search:
        search_filter = or_(
            Lead.first_name.ilike(f"%{search}%"),
            Lead.last_name.ilike(f"%{search}%"),
            Lead.email.ilike(f"%{search}%"),
            Lead.phone.ilike(f"%{search}%")
        )
        query = query.where(search_filter)
        
    # Pagination
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    query = query.order_by(Lead.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    # Enrich with user and dealership info
    enriched_items = await enrich_leads_with_relations(db, items)
    
    return {
        "items": enriched_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size
    }


@router.post("/", response_model=LeadResponse)
async def create_lead(
    *,
    db: AsyncSession = Depends(get_db),
    lead_in: LeadCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.require_permission(Permission.CREATE_LEAD))
) -> Any:
    """
    Create a new lead.
    """
    # Use current user's dealership if not specified (for dealer admin)
    dealership_id = lead_in.dealership_id
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        dealership_id = current_user.dealership_id
        
    lead = Lead(
        **lead_in.model_dump(exclude={"dealership_id", "meta_data"}),
        dealership_id=dealership_id,
        created_by=current_user.id,
        meta_data=lead_in.meta_data
    )
    
    db.add(lead)
    await db.flush()
    
    # Log activity
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_CREATED,
        description=f"Lead created by {current_user.email}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=dealership_id
    )
    
    # Send notification to all dealership members when a new lead is added
    if dealership_id:
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "New Lead"
        source_display = lead.source.value if lead.source else "unknown"
        background_tasks.add_task(
            notify_lead_assigned_to_dealership_background,
            lead_id=lead.id,
            lead_name=lead_name,
            dealership_id=dealership_id,
            source=source_display,
        )
    
    # Emit WebSocket event so sidebar unassigned count updates when new unassigned lead is created
    if lead.dealership_id is None:
        try:
            from app.services.notification_service import emit_badges_refresh
            await emit_badges_refresh(unassigned=True)
        except Exception:
            pass
    
    return lead


@router.patch("/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: UUID,
    lead_in: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update lead details (contact info, address, personal details).
    Available to dealership users who can access the lead.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Access check: unassigned pool is open to all dealership users
    is_unassigned_pool = lead.dealership_id is None
    if not is_unassigned_pool:
        # Must have access to assigned leads
        has_access = (
            current_user.role == UserRole.SUPER_ADMIN
            or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
            or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
        )
        if not has_access:
            raise HTTPException(status_code=403, detail="Not authorized to update this lead")
    
    # Update lead fields
    update_data = lead_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(lead, field, value)
    
    lead.updated_at = utc_now()
    
    # Log update activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    updated_fields = list(update_data.keys())
    
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_UPDATED,
        description=f"Lead details updated by {performer_name}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "performer_name": performer_name,
            "updated_fields": updated_fields
        }
    )
    
    await db.flush()
    return lead


@router.get("/{lead_id}", response_model=LeadDetail)
async def get_lead(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get lead details including activity timeline and related users.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Unassigned pool: lead has no dealership - visible to everyone who can see unassigned in list
    if lead.dealership_id is None:
        if current_user.role == UserRole.SUPER_ADMIN or current_user.dealership_id is not None:
            access_level = "full"  # Super Admin or any dealership user can access unassigned leads
        else:
            access_level = None  # User with no dealership - check mention only
    else:
        access_level = "full"
    
    # Role-based access for assigned/dealership leads
    # Salespersons can view any lead in their dealership (assigned or not); admins/owners only their dealership
    if access_level is not None and lead.dealership_id is not None:
        if current_user.role == UserRole.SALESPERSON:
            if lead.dealership_id != current_user.dealership_id:
                access_level = None  # different dealership - no access unless mentioned
            # else: same dealership - keep full access (view unassigned-to-salesperson leads)
        elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id != current_user.dealership_id:
            access_level = None  # no access unless mentioned
    
    if access_level is None:
        # Check if user is mentioned in any note on this lead (allows read + reply only)
        from app.models.activity import Activity
        notes_result = await db.execute(
            select(Activity).where(
                Activity.lead_id == lead_id,
                Activity.type == ActivityType.NOTE_ADDED
            )
        )
        note_activities = notes_result.scalars().all()
        mentioned_ids = set()
        for act in note_activities:
            ids = act.meta_data.get("mentioned_user_ids") or []
            mentioned_ids.update(str(i) for i in ids)
        if str(current_user.id) in mentioned_ids:
            access_level = "mention_only"
        else:
            raise HTTPException(status_code=403, detail="Not authorized")
    
    # Build response with related data
    response_data = {
        "id": lead.id,
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "email": lead.email,
        "phone": lead.phone,
        "alternate_phone": lead.alternate_phone,
        "source": lead.source,
        "status": lead.status,
        "dealership_id": lead.dealership_id,
        "assigned_to": lead.assigned_to,
        "created_by": lead.created_by,
        "notes": lead.notes,
        "meta_data": lead.meta_data,
        "interested_in": lead.interested_in,
        "budget_range": lead.budget_range,
        # Address fields
        "address": lead.address,
        "city": lead.city,
        "state": lead.state,
        "postal_code": lead.postal_code,
        "country": lead.country,
        # Additional details
        "date_of_birth": lead.date_of_birth,
        "company": lead.company,
        "job_title": lead.job_title,
        "preferred_contact_method": lead.preferred_contact_method,
        "preferred_contact_time": lead.preferred_contact_time,
        # Timestamps
        "first_contacted_at": lead.first_contacted_at,
        "last_contacted_at": lead.last_contacted_at,
        "converted_at": lead.converted_at,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
        "assigned_to_user": None,
        "created_by_user": None,
        "dealership": None,
        "access_level": access_level
    }
    
    # Fetch assigned user info
    if lead.assigned_to:
        user_result = await db.execute(select(User).where(User.id == lead.assigned_to))
        assigned_user = user_result.scalar_one_or_none()
        if assigned_user:
            response_data["assigned_to_user"] = {
                "id": assigned_user.id,
                "email": assigned_user.email,
                "first_name": assigned_user.first_name,
                "last_name": assigned_user.last_name,
                "role": assigned_user.role,
                "is_active": assigned_user.is_active,
                "dealership_id": assigned_user.dealership_id
            }
    
    # Fetch created by user info
    if lead.created_by:
        creator_result = await db.execute(select(User).where(User.id == lead.created_by))
        creator = creator_result.scalar_one_or_none()
        if creator:
            response_data["created_by_user"] = {
                "id": creator.id,
                "email": creator.email,
                "first_name": creator.first_name,
                "last_name": creator.last_name,
                "role": creator.role,
                "is_active": creator.is_active,
                "dealership_id": creator.dealership_id
            }
    
    # Fetch dealership info
    if lead.dealership_id:
        dealership_result = await db.execute(select(Dealership).where(Dealership.id == lead.dealership_id))
        dealership = dealership_result.scalar_one_or_none()
        if dealership:
            response_data["dealership"] = {
                "id": dealership.id,
                "name": dealership.name
            }
        
    return response_data


@router.post("/{lead_id}/status", response_model=LeadResponse)
async def update_lead_status(
    lead_id: UUID,
    status_in: LeadStatusUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update lead status and log the change.
    Auto-assigns the lead if it's in the unassigned pool.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Soft SKATE check: check if this is a SKATE scenario
    skate_info = await check_skate_condition(db, current_user, lead, "status change")
    is_skate_action = False
    
    if skate_info:
        if not status_in.confirm_skate:
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
                    action="updated status",
                    performer_user_id=current_user.id,
                )

    # Access check: unassigned pool is open to all dealership users
    is_unassigned_pool = lead.dealership_id is None
    if not is_unassigned_pool:
        # Must have access to assigned leads (admins/owners)
        has_access = (
            current_user.role == UserRole.SUPER_ADMIN
            or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
            or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
        )
        if not has_access:
            raise HTTPException(status_code=403, detail="Not authorized to update this lead")
    
    # Salesperson cannot set status to LOST or CLOSED - only admin/owner/superadmin can
    restricted_statuses = [LeadStatus.LOST, LeadStatus.CLOSED]
    if status_in.status in restricted_statuses and current_user.role == UserRole.SALESPERSON:
        raise HTTPException(
            status_code=403, 
            detail="Only admins or owners can mark leads as lost or closed"
        )

    notification_service = NotificationService(db)

    # Auto-assignment: if lead is in unassigned pool and user has a dealership
    auto_assigned = await auto_assign_lead_on_activity(
        db, lead, current_user, "status_change", notification_service
    )

    old_status = lead.status.value
    lead.status = status_in.status
    lead.last_activity_at = utc_now()
    
    # Log status change with performer name
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    await ActivityService.log_lead_status_change(
        db,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        old_status=old_status,
        new_status=status_in.status.value,
        performer_name=performer_name,
        notes=status_in.notes,
        is_skate_action=is_skate_action
    )
    
    await db.flush()
    
    # Emit real-time WebSocket event with updated lead status
    try:
        from app.services.notification_service import emit_lead_updated
        await emit_lead_updated(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            "status_changed",
            {
                "status": status_in.status.value,
                "old_status": old_status
            }
        )
    except Exception as e:
        logger.error(f"Failed to emit lead:updated WebSocket event: {e}")
    
    return lead


@router.post("/{lead_id}/assign", response_model=LeadResponse)
async def assign_lead(
    lead_id: UUID,
    assign_in: LeadAssignment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_SALESPERSON))
) -> Any:
    """
    Assign lead to a salesperson.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    # Verify target user exists and is in same dealership (if not super admin)
    user_result = await db.execute(select(User).where(User.id == assign_in.assigned_to))
    assign_to_user = user_result.scalar_one_or_none()
    
    if not assign_to_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if current_user.role != UserRole.SUPER_ADMIN:
        if assign_to_user.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=400, detail="Cannot assign to user in different dealership")

    # Check if this is a reassignment
    old_assigned_to_id = lead.assigned_to
    old_assigned_to_name = None
    if old_assigned_to_id:
        old_user_result = await db.execute(select(User).where(User.id == old_assigned_to_id))
        old_user = old_user_result.scalar_one_or_none()
        if old_user:
            old_assigned_to_name = f"{old_user.first_name} {old_user.last_name}"

    lead.assigned_to = assign_in.assigned_to
    
    # Log assignment with names
    assigned_to_name = f"{assign_to_user.first_name} {assign_to_user.last_name}"
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    
    # Use different description for reassignment
    is_reassignment = old_assigned_to_id is not None and old_assigned_to_id != assign_in.assigned_to
    description = f"Lead reassigned from {old_assigned_to_name} to {assigned_to_name} by {performer_name}" if is_reassignment and old_assigned_to_name else f"Lead assigned to {assigned_to_name} by {performer_name}"
    
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_ASSIGNED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "assigned_to": str(assign_in.assigned_to),
            "assigned_to_name": assigned_to_name,
            "old_assigned_to": str(old_assigned_to_id) if old_assigned_to_id else None,
            "old_assigned_to_name": old_assigned_to_name,
            "performer_name": performer_name,
            "is_reassignment": is_reassignment,
            "notes": assign_in.notes
        }
    )
    
    # Create notification for the assigned user (only if it's a new assignment or reassignment to a different user)
    # Don't notify if reassigning to the same user
    if old_assigned_to_id != assign_in.assigned_to:
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
        notification_service = NotificationService(db)
        await notification_service.notify_lead_assigned(
            user_id=assign_in.assigned_to,
            lead_name=lead_name,
            lead_id=lead.id,
            assigned_by=performer_name
        )
    
    await db.flush()
    
    # Emit real-time WebSocket event with updated lead data
    try:
        from app.services.notification_service import emit_lead_updated
        # Fetch dealership name if assigned
        dealership_data = None
        if lead.dealership_id:
            dealership_result = await db.execute(select(Dealership).where(Dealership.id == lead.dealership_id))
            dealership = dealership_result.scalar_one_or_none()
            if dealership:
                dealership_data = {"id": str(dealership.id), "name": dealership.name}
        
        await emit_lead_updated(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            "assigned",
            {
                "assigned_to": str(assign_in.assigned_to),
                "assigned_to_user": {
                    "id": str(assign_to_user.id),
                    "first_name": assign_to_user.first_name,
                    "last_name": assign_to_user.last_name,
                    "email": assign_to_user.email,
                    "role": assign_to_user.role
                },
                "dealership": dealership_data
            }
        )
    except Exception as e:
        logger.error(f"Failed to emit lead:updated WebSocket event: {e}")
    
    return lead


@router.post("/{lead_id}/assign-dealership", response_model=LeadResponse)
async def assign_lead_to_dealership(
    lead_id: UUID,
    assign_in: LeadDealershipAssignment,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_DEALERSHIP))
) -> Any:
    """
    Super Admin assigns lead to a dealership.
    This moves the lead from the unassigned pool to a specific dealership.
    Notifies all members of the dealership.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Verify dealership exists
    dealership_result = await db.execute(
        select(Dealership).where(Dealership.id == assign_in.dealership_id)
    )
    dealership = dealership_result.scalar_one_or_none()
    
    if not dealership:
        raise HTTPException(status_code=404, detail="Dealership not found")
    
    if not dealership.is_active:
        raise HTTPException(status_code=400, detail="Cannot assign to inactive dealership")
    
    old_dealership_id = lead.dealership_id
    lead.dealership_id = assign_in.dealership_id
    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "Lead"
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    
    # Log activity with names
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_ASSIGNED,
        description=f"Lead assigned to dealership {dealership.name} by {performer_name}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=assign_in.dealership_id,
        meta_data={
            "old_dealership_id": str(old_dealership_id) if old_dealership_id else None,
            "new_dealership_id": str(assign_in.dealership_id),
            "dealership_name": dealership.name,
            "performer_name": performer_name,
            "notes": assign_in.notes
        }
    )
    
    await db.flush()
    
    # Notify all dealership members in background (don't hold the API response)
    background_tasks.add_task(
        notify_lead_assigned_to_dealership_background,
        lead_id=lead.id,
        lead_name=lead_name,
        dealership_id=assign_in.dealership_id,
        performer_name=performer_name,
    )
    
    # Emit real-time WebSocket event with updated lead data
    try:
        from app.services.notification_service import emit_lead_updated
        await emit_lead_updated(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            "dealership_assigned",
            {
                "dealership_id": str(assign_in.dealership_id),
                "dealership": {
                    "id": str(dealership.id),
                    "name": dealership.name
                }
            }
        )
    except Exception as e:
        logger.error(f"Failed to emit lead:updated WebSocket event: {e}")
    
    return lead


@router.post("/bulk-assign-dealership")
async def bulk_assign_leads_to_dealership(
    assignment_in: BulkLeadDealershipAssignment,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_DEALERSHIP))
) -> Any:
    """
    Bulk assign multiple leads to a dealership.
    Super Admin only. Notifies all dealership members for each lead.
    """
    # Verify dealership exists
    dealership_result = await db.execute(
        select(Dealership).where(Dealership.id == assignment_in.dealership_id)
    )
    dealership = dealership_result.scalar_one_or_none()
    
    if not dealership:
        raise HTTPException(status_code=404, detail="Dealership not found")
    
    if not dealership.is_active:
        raise HTTPException(status_code=400, detail="Cannot assign to inactive dealership")
    
    # Get all leads
    result = await db.execute(select(Lead).where(Lead.id.in_(assignment_in.lead_ids)))
    leads = result.scalars().all()
    
    if len(leads) != len(assignment_in.lead_ids):
        raise HTTPException(status_code=404, detail="One or more leads not found")
    
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    assigned_count = 0
    for lead in leads:
        lead.dealership_id = assignment_in.dealership_id
        assigned_count += 1
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "Lead"
        
        # Log activity for each lead
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.LEAD_ASSIGNED,
            description=f"Lead bulk assigned to dealership {dealership.name} by {performer_name}",
            user_id=current_user.id,
            lead_id=lead.id,
            dealership_id=assignment_in.dealership_id,
            meta_data={
                "bulk_assignment": True,
                "dealership_name": dealership.name,
                "performer_name": performer_name,
                "notes": assignment_in.notes
            }
        )
        # Notify all dealership members for this lead (background, don't hold response)
        background_tasks.add_task(
            notify_lead_assigned_to_dealership_background,
            lead_id=lead.id,
            lead_name=lead_name,
            dealership_id=assignment_in.dealership_id,
            performer_name=performer_name,
        )
    
    await db.commit()
    
    return {
        "message": f"Successfully assigned {assigned_count} leads to {dealership.name}",
        "assigned_count": assigned_count,
        "dealership_id": str(assignment_in.dealership_id)
    }


@router.post("/{lead_id}/notes", response_model=LeadResponse)
async def add_lead_note(
    lead_id: UUID,
    note_in: NoteCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Add a note to the lead timeline.
    Supports:
    - Replies to existing notes (parent_id)
    - @mentions (mentioned_user_ids)
    - Auto-assignment: If lead is in unassigned pool and user has a dealership,
      automatically assigns the lead to the user and their dealership.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Soft SKATE check for notes: check if this is a SKATE scenario
    # For notes, mentioning the assigned user avoids SKATE
    logger.info(f"add_lead_note: user={current_user.email} role={current_user.role} lead_assigned_to={lead.assigned_to} confirm_skate={note_in.confirm_skate}")
    skate_info = await check_note_skate_condition(db, current_user, lead, note_in.mentioned_user_ids)
    is_skate_action = False
    logger.info(f"add_lead_note: skate_info={skate_info}")
    
    if skate_info:
        if not note_in.confirm_skate:
            # Return skate warning for confirmation
            logger.info("add_lead_note: Returning skate_warning response")
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
                    action="added a note",
                    performer_user_id=current_user.id,
                )
    
    # Access check: 
    # - Unassigned pool leads (no dealership) are accessible to all dealership users
    # - Assigned leads: user must have full access or be mentioned
    is_unassigned_pool = lead.dealership_id is None
    has_full = (
        current_user.role == UserRole.SUPER_ADMIN
        or is_unassigned_pool  # Anyone with dealership can work on unassigned leads
        or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
        or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
    )
    if not has_full:
        from app.models.activity import Activity as ActivityModel
        notes_result = await db.execute(
            select(ActivityModel).where(
                ActivityModel.lead_id == lead_id,
                ActivityModel.type == ActivityType.NOTE_ADDED
            )
        )
        note_activities = notes_result.scalars().all()
        mentioned_ids = set()
        for act in note_activities:
            ids = act.meta_data.get("mentioned_user_ids") or []
            mentioned_ids.update(str(i) for i in ids)
        if str(current_user.id) not in mentioned_ids:
            raise HTTPException(status_code=403, detail="Not authorized to add notes to this lead")
    
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    notification_service = NotificationService(db)
    
    # Auto-assignment: if lead is in unassigned pool and user has a dealership
    auto_assigned = await auto_assign_lead_on_activity(
        db, lead, current_user, "note", notification_service
    )
    
    # Validate parent_id if provided (for replies)
    if note_in.parent_id:
        from app.models.activity import Activity
        parent_result = await db.execute(
            select(Activity).where(
                Activity.id == note_in.parent_id,
                Activity.lead_id == lead_id,
                Activity.type == ActivityType.NOTE_ADDED
            )
        )
        parent_note = parent_result.scalar_one_or_none()
        if not parent_note:
            raise HTTPException(status_code=404, detail="Parent note not found")
    
    # Build metadata
    meta_data = {
        "content": note_in.content, 
        "performer_name": performer_name,
        "is_reply": note_in.parent_id is not None
    }
    
    # Add mentioned users to metadata
    if note_in.mentioned_user_ids:
        meta_data["mentioned_user_ids"] = [str(uid) for uid in note_in.mentioned_user_ids]
        
        # Verify mentioned users exist and are in the same dealership
        mentioned_users_result = await db.execute(
            select(User).where(User.id.in_(note_in.mentioned_user_ids))
        )
        mentioned_users = mentioned_users_result.scalars().all()
        meta_data["mentioned_users"] = [
            {"id": str(u.id), "name": f"{u.first_name} {u.last_name}"} 
            for u in mentioned_users
        ]
    
    # Add is_skate_action to metadata if applicable
    if is_skate_action:
        meta_data["is_skate_action"] = True
    
    # Log note as activity with parent_id for threading
    from app.models.activity import Activity
    description = f"{'Reply' if note_in.parent_id else 'Note'} added by {performer_name}"
    if is_skate_action:
        description = f"[SKATE] {description}"
    note_activity = Activity(
        type=ActivityType.NOTE_ADDED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id or current_user.dealership_id,
        parent_id=note_in.parent_id,
        meta_data=meta_data
    )
    db.add(note_activity)
    await db.flush()  # Flush so note_activity.id is set for mention link
    
    # Update lead's last activity timestamp
    lead.last_activity_at = utc_now()
    
    # Send notifications to mentioned users (link includes note id so frontend can scroll to it)
    if note_in.mentioned_user_ids:
        from app.models.notification import NotificationType
        lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
        for mentioned_user_id in note_in.mentioned_user_ids:
            if mentioned_user_id != current_user.id:  # Don't notify yourself
                await notification_service.create_notification(
                    user_id=mentioned_user_id,
                    notification_type=NotificationType.MENTION,
                    title=f"You were mentioned by {performer_name}",
                    message=f"In a note on lead: {lead_name}",
                    link=f"/leads/{lead.id}?note={note_activity.id}",
                    related_id=lead.id,
                    related_type="lead",
                    meta_data={
                        "lead_id": str(lead.id),
                        "activity_id": str(note_activity.id),
                        "lead_name": lead_name,
                        "mentioned_by": performer_name,
                        "note_preview": note_in.content[:100] + "..." if len(note_in.content) > 100 else note_in.content
                    }
                )
        # Emit WebSocket events so mentioned users see the new note and notification badge updates
        from app.services.notification_service import emit_activity_added, emit_badges_refresh
        await emit_activity_added(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            {
                "activity_id": str(note_activity.id),
                "type": "note_added",
                "performer_name": performer_name,
                "has_mentions": True,
            }
        )
        await emit_badges_refresh(notifications=True)
    
    await db.flush()
    return lead


@router.post("/{lead_id}/log-call")
async def log_call(
    lead_id: UUID,
    call_in: CallLogCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Log a phone call to a lead.
    Auto-assigns the lead if it's in the unassigned pool.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Soft SKATE check: check if this is a SKATE scenario
    skate_info = await check_skate_condition(db, current_user, lead, "log call")
    is_skate_action = False
    
    if skate_info:
        if not call_in.confirm_skate:
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
                    action="logged a call",
                    performer_user_id=current_user.id,
                )

    # Access check: unassigned pool is open to all dealership users
    is_unassigned_pool = lead.dealership_id is None
    if not is_unassigned_pool:
        # Must have access to assigned leads (admins/owners)
        has_access = (
            current_user.role == UserRole.SUPER_ADMIN
            or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
            or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
        )
        if not has_access:
            raise HTTPException(status_code=403, detail="Not authorized to log calls for this lead")

    notification_service = NotificationService(db)

    # Auto-assignment: if lead is in unassigned pool and user has a dealership
    auto_assigned = await auto_assign_lead_on_activity(
        db, lead, current_user, "call", notification_service
    )
    
    # Update last contacted
    lead.last_contacted_at = utc_now()
    lead.last_activity_at = utc_now()
    if not lead.first_contacted_at:
        lead.first_contacted_at = utc_now()
        
    # Log call as activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    description = f"Call logged by {performer_name}: {call_in.outcome}"
    if is_skate_action:
        description = f"[SKATE] {description}"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.CALL_LOGGED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "duration_seconds": call_in.duration_seconds,
            "outcome": call_in.outcome,
            "notes": call_in.notes,
            "performer_name": performer_name,
            "auto_assigned": auto_assigned,
            "is_skate_action": is_skate_action
        }
    )
    
    await db.flush()
    
    return {
        "message": "Call logged successfully",
        "lead_id": str(lead_id),
        "outcome": call_in.outcome,
        "auto_assigned": auto_assigned
    }


@router.post("/{lead_id}/log-email")
async def log_email(
    lead_id: UUID,
    email_in: EmailLogCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Log an email to/from a lead.
    Auto-assigns the lead if it's in the unassigned pool (for sent emails).
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Soft SKATE check: check if this is a SKATE scenario
    skate_info = await check_skate_condition(db, current_user, lead, "log email")
    is_skate_action = False
    
    if skate_info:
        if not email_in.confirm_skate:
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
                    action="logged an email",
                    performer_user_id=current_user.id,
                )

    # Access check: unassigned pool is open to all dealership users
    is_unassigned_pool = lead.dealership_id is None
    if not is_unassigned_pool:
        # Must have access to assigned leads (admins/owners)
        has_access = (
            current_user.role == UserRole.SUPER_ADMIN
            or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
            or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
        )
        if not has_access:
            raise HTTPException(status_code=403, detail="Not authorized to log emails for this lead")

    notification_service = NotificationService(db)

    # Auto-assignment: if lead is in unassigned pool and user has a dealership (only for sent emails)
    auto_assigned = False
    if email_in.direction == "sent":
        auto_assigned = await auto_assign_lead_on_activity(
            db, lead, current_user, "email", notification_service
        )
    
    # Update last contacted for sent emails
    if email_in.direction == "sent":
        lead.last_contacted_at = utc_now()
        lead.last_activity_at = utc_now()
        if not lead.first_contacted_at:
            lead.first_contacted_at = utc_now()
    
    activity_type = ActivityType.EMAIL_SENT if email_in.direction == "sent" else ActivityType.EMAIL_RECEIVED
        
    # Log email as activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    description = f"Email {email_in.direction} by {performer_name}: {email_in.subject}"
    if is_skate_action:
        description = f"[SKATE] {description}"
    await ActivityService.log_activity(
        db,
        activity_type=activity_type,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "subject": email_in.subject,
            "body": email_in.body,
            "direction": email_in.direction,
            "performer_name": performer_name,
            "auto_assigned": auto_assigned,
            "is_skate_action": is_skate_action
        }
    )
    
    await db.flush()
    
    return {
        "message": f"Email {email_in.direction} logged successfully",
        "lead_id": str(lead_id),
        "subject": email_in.subject
    }


@router.delete("/{lead_id}")
async def delete_lead(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.DELETE_LEAD))
) -> Any:
    """
    Delete a lead.
    Only Super Admin can delete leads.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Get lead info for logging
    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    
    # Log deletion activity before deleting
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_DELETED,
        description=f"Lead '{lead_name}' deleted by {performer_name}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "lead_name": lead_name,
            "lead_email": lead.email,
            "lead_phone": lead.phone,
            "performer_name": performer_name,
            "deleted_at": utc_now().isoformat()
        }
    )
    
    # Delete the lead
    await db.delete(lead)
    await db.commit()
    
    return {
        "message": f"Lead '{lead_name}' deleted successfully",
        "lead_id": str(lead_id)
    }
