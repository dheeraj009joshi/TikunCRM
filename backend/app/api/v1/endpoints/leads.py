"""
Lead Endpoints
"""
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
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
from app.services.notification_service import NotificationService


# Request schemas for call/email logging
class CallLogCreate(BaseModel):
    """Schema for logging a call"""
    duration_seconds: Optional[int] = None
    outcome: str
    notes: Optional[str] = None


class EmailLogCreate(BaseModel):
    """Schema for logging an email"""
    subject: str
    body: Optional[str] = None
    direction: str = "sent"  # sent or received


router = APIRouter()


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
    search: Optional[str] = None
) -> Any:
    """
    List leads with filtering and pagination.
    Role-based isolation is applied.
    Includes assigned_to_user and dealership info.
    """
    query = select(Lead)
    
    # Isolation
    if current_user.role == UserRole.SALESPERSON:
        query = query.where(Lead.assigned_to == current_user.id)
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        query = query.where(Lead.dealership_id == current_user.dealership_id)
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
    
    # Role-based filtering
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        query = query.where(Lead.dealership_id == current_user.dealership_id)
    elif current_user.role == UserRole.SALESPERSON:
        raise HTTPException(status_code=403, detail="Salespersons cannot view unassigned leads")
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
        
    # Isolation check
    if current_user.role == UserRole.SALESPERSON and lead.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id != current_user.dealership_id:
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
        "first_contacted_at": lead.first_contacted_at,
        "last_contacted_at": lead.last_contacted_at,
        "converted_at": lead.converted_at,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
        "assigned_to_user": None,
        "created_by_user": None,
        "dealership": None
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.UPDATE_LEAD))
) -> Any:
    """
    Update lead status and log the change.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    old_status = lead.status.value
    lead.status = status_in.status
    
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
        notes=status_in.notes
    )
    
    await db.flush()
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
    return lead


@router.post("/{lead_id}/assign-dealership", response_model=LeadResponse)
async def assign_lead_to_dealership(
    lead_id: UUID,
    assign_in: LeadDealershipAssignment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_DEALERSHIP))
) -> Any:
    """
    Super Admin assigns lead to a dealership.
    This moves the lead from the unassigned pool to a specific dealership.
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
    
    # Log activity with names
    performer_name = f"{current_user.first_name} {current_user.last_name}"
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
    return lead


@router.post("/bulk-assign-dealership")
async def bulk_assign_leads_to_dealership(
    assignment_in: BulkLeadDealershipAssignment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_DEALERSHIP))
) -> Any:
    """
    Bulk assign multiple leads to a dealership.
    Super Admin only.
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Add a note to the lead timeline.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    # Log note as activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.NOTE_ADDED,
        description=f"Note added by {performer_name}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={"content": note_in.content, "performer_name": performer_name}
    )
    
    await db.flush()
    return lead


@router.post("/{lead_id}/log-call")
async def log_call(
    lead_id: UUID,
    call_in: CallLogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Log a phone call to a lead.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Update last contacted
    lead.last_contacted_at = datetime.utcnow()
    if not lead.first_contacted_at:
        lead.first_contacted_at = datetime.utcnow()
        
    # Log call as activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.CALL_LOGGED,
        description=f"Call logged by {performer_name}: {call_in.outcome}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "duration_seconds": call_in.duration_seconds,
            "outcome": call_in.outcome,
            "notes": call_in.notes,
            "performer_name": performer_name
        }
    )
    
    await db.flush()
    
    return {
        "message": "Call logged successfully",
        "lead_id": str(lead_id),
        "outcome": call_in.outcome
    }


@router.post("/{lead_id}/log-email")
async def log_email(
    lead_id: UUID,
    email_in: EmailLogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Log an email to/from a lead.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Update last contacted for sent emails
    if email_in.direction == "sent":
        lead.last_contacted_at = datetime.utcnow()
        if not lead.first_contacted_at:
            lead.first_contacted_at = datetime.utcnow()
    
    activity_type = ActivityType.EMAIL_SENT if email_in.direction == "sent" else ActivityType.EMAIL_RECEIVED
        
    # Log email as activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    await ActivityService.log_activity(
        db,
        activity_type=activity_type,
        description=f"Email {email_in.direction} by {performer_name}: {email_in.subject}",
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "subject": email_in.subject,
            "body": email_in.body,
            "direction": email_in.direction,
            "performer_name": performer_name
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
            "deleted_at": datetime.utcnow().isoformat()
        }
    )
    
    # Delete the lead
    await db.delete(lead)
    await db.commit()
    
    return {
        "message": f"Lead '{lead_name}' deleted successfully",
        "lead_id": str(lead_id)
    }
