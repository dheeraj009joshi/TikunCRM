"""
Lead Endpoints
"""
import logging
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead, LeadSource
from app.models.customer import Customer
from app.models.lead_stage import LeadStage
from app.models.activity import Activity, ActivityType
from app.models.dealership import Dealership
from app.schemas.lead import (
    LeadResponse, LeadCreate, LeadUpdate, LeadDetail,
    LeadStageChangeRequest, LeadStatusUpdateCompat, LeadAssignment, LeadListResponse,
    LeadDealershipAssignment, BulkLeadDealershipAssignment,
    LeadSecondaryAssignment, LeadSwapSalespersons
)
from app.schemas.activity import NoteCreate
from app.schemas.stips import StipDocumentResponse, StipDocumentViewUrl
from app.services.activity import ActivityService
from app.services.stips_service import (
    _lead_access,
    list_documents_for_lead,
    upload_document_for_lead,
    delete_document_for_lead,
    resolve_document_for_lead,
    get_document_info_for_lead,
)
from app.services.customer_service import CustomerService
from app.services.lead_stage_service import LeadStageService
from app.services.notification_service import (
    NotificationService,
    send_skate_alert_background,
    notify_lead_assigned_to_dealership_background,
)
from app.core.config import settings as app_settings
from app.services.azure_storage_service import azure_storage_service
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
    # Get lead name from customer
    cust_result = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
    cust = cust_result.scalar_one_or_none()
    lead_name = cust.full_name if cust else "Lead"

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
    """Add customer, stage, assigned_to_user, secondary_salesperson, and dealership info to leads."""
    if not leads:
        return []

    # Collect IDs
    user_ids = set()
    dealership_ids = set()
    customer_ids = set()
    stage_ids = set()
    for lead in leads:
        if lead.assigned_to:
            user_ids.add(lead.assigned_to)
        if hasattr(lead, 'secondary_salesperson_id') and lead.secondary_salesperson_id:
            user_ids.add(lead.secondary_salesperson_id)
        if lead.dealership_id:
            dealership_ids.add(lead.dealership_id)
        if lead.customer_id:
            customer_ids.add(lead.customer_id)
        if getattr(lead, 'secondary_customer_id', None):
            customer_ids.add(lead.secondary_customer_id)
        if lead.stage_id:
            stage_ids.add(lead.stage_id)

    # Fetch customers
    customers_map = {}
    if customer_ids:
        cust_result = await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))
        for c in cust_result.scalars().all():
            customers_map[c.id] = {
                "id": str(c.id),
                "first_name": c.first_name,
                "last_name": c.last_name,
                "full_name": c.full_name,
                "phone": c.phone,
                "email": c.email,
            }

    # Fetch stages
    stages_map = {}
    if stage_ids:
        stage_result = await db.execute(select(LeadStage).where(LeadStage.id.in_(stage_ids)))
        for s in stage_result.scalars().all():
            stages_map[s.id] = {
                "id": str(s.id),
                "name": s.name,
                "display_name": s.display_name,
                "order": s.order,
                "color": s.color,
                "dealership_id": str(s.dealership_id) if s.dealership_id else None,
                "is_terminal": s.is_terminal,
                "is_active": s.is_active,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }

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
                "dealership_id": str(user.dealership_id) if user.dealership_id else None,
            }

    # Fetch dealerships
    dealerships_map = {}
    if dealership_ids:
        dealership_result = await db.execute(select(Dealership).where(Dealership.id.in_(dealership_ids)))
        for dealership in dealership_result.scalars().all():
            dealerships_map[dealership.id] = {"id": str(dealership.id), "name": dealership.name}

    # Activity count per lead (for "fresh" / untouched indicator: only creation activity = 1)
    lead_ids = [l.id for l in leads]
    activity_counts = {}
    if lead_ids:
        act_result = await db.execute(
            select(Activity.lead_id, func.count(Activity.id).label("count"))
            .where(Activity.lead_id.in_(lead_ids))
            .group_by(Activity.lead_id)
        )
        for row in act_result.all():
            activity_counts[row.lead_id] = row.count

    # Build enriched response
    enriched_items = []
    for lead in leads:
        lead_dict = {
            "id": str(lead.id),
            "customer_id": str(lead.customer_id),
            "customer": customers_map.get(lead.customer_id),
            "secondary_customer_id": str(lead.secondary_customer_id) if getattr(lead, 'secondary_customer_id', None) else None,
            "secondary_customer": customers_map.get(lead.secondary_customer_id) if getattr(lead, 'secondary_customer_id', None) else None,
            "stage_id": str(lead.stage_id),
            "stage": stages_map.get(lead.stage_id),
            "source": lead.source.value if hasattr(lead.source, 'value') else str(lead.source),
            "is_active": lead.is_active,
            "outcome": lead.outcome,
            "interest_score": lead.interest_score,
            "dealership_id": str(lead.dealership_id) if lead.dealership_id else None,
            "assigned_to": str(lead.assigned_to) if lead.assigned_to else None,
            "secondary_salesperson_id": str(lead.secondary_salesperson_id) if hasattr(lead, 'secondary_salesperson_id') and lead.secondary_salesperson_id else None,
            "created_by": str(lead.created_by) if lead.created_by else None,
            "notes": lead.notes,
            "meta_data": lead.meta_data or {},
            "external_id": lead.external_id,
            "interested_in": lead.interested_in,
            "budget_range": lead.budget_range,
            "first_contacted_at": lead.first_contacted_at.isoformat() if lead.first_contacted_at else None,
            "last_contacted_at": lead.last_contacted_at.isoformat() if lead.last_contacted_at else None,
            "converted_at": lead.converted_at.isoformat() if lead.converted_at else None,
            "closed_at": lead.closed_at.isoformat() if lead.closed_at else None,
            "created_at": lead.created_at.isoformat() if lead.created_at else None,
            "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
            "assigned_to_user": users_map.get(lead.assigned_to) if lead.assigned_to else None,
            "secondary_salesperson": users_map.get(lead.secondary_salesperson_id) if hasattr(lead, 'secondary_salesperson_id') and lead.secondary_salesperson_id else None,
            "dealership": dealerships_map.get(lead.dealership_id) if lead.dealership_id else None,
            "activity_count": activity_counts.get(lead.id, 0),
        }
        enriched_items.append(lead_dict)

    return enriched_items


@router.get("/")
async def list_leads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    stage_id: Optional[UUID] = None,
    source: Optional[LeadSource] = None,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    pool: Optional[str] = None,  # "unassigned" | "mine" | None (all)
    fresh_only: Optional[bool] = Query(None, description="Only leads with no activity except creation (untouched/fresh)")
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
    if stage_id:
        query = query.where(Lead.stage_id == stage_id)
    if source:
        query = query.where(Lead.source == source)
    if is_active is not None:
        query = query.where(Lead.is_active == is_active)
    if search:
        # Search via Customer (name, phone, email)
        query = query.join(Customer, Lead.customer_id == Customer.id)
        full_name = func.concat(Customer.first_name, ' ', func.coalesce(Customer.last_name, ''))
        search_filter = or_(
            Customer.first_name.ilike(f"%{search}%"),
            Customer.last_name.ilike(f"%{search}%"),
            full_name.ilike(f"%{search}%"),
            Customer.email.ilike(f"%{search}%"),
            Customer.phone.ilike(f"%{search}%"),
        )
        query = query.where(search_filter)

    # Fresh/untouched leads only: exactly one activity (creation) AND not assigned to anyone
    if fresh_only:
        fresh_subq = (
            select(Activity.lead_id)
            .where(Activity.lead_id.isnot(None))
            .group_by(Activity.lead_id)
            .having(func.count(Activity.id) == 1)
        )
        query = query.where(Lead.id.in_(fresh_subq)).where(Lead.assigned_to.is_(None))

    # Pagination
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    query = query.order_by(Lead.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    items = result.scalars().all()

    enriched_items = await enrich_leads_with_relations(db, items)

    return {
        "items": enriched_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
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

    if source:
        query = query.where(Lead.source == source)
    if search:
        query = query.join(Customer, Lead.customer_id == Customer.id)
        full_name = func.concat(Customer.first_name, ' ', func.coalesce(Customer.last_name, ''))
        search_filter = or_(
            Customer.first_name.ilike(f"%{search}%"),
            Customer.last_name.ilike(f"%{search}%"),
            full_name.ilike(f"%{search}%"),
            Customer.email.ilike(f"%{search}%"),
            Customer.phone.ilike(f"%{search}%"),
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
    
    enriched_items = await enrich_leads_with_relations(db, items)
    
    return {
        "items": enriched_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
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
    """
    query = select(Lead).where(
        and_(Lead.dealership_id.isnot(None), Lead.assigned_to.is_(None))
    )

    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER, UserRole.SALESPERSON]:
        if current_user.dealership_id:
            query = query.where(Lead.dealership_id == current_user.dealership_id)
        else:
            query = query.where(Lead.id.is_(None))

    if search:
        query = query.join(Customer, Lead.customer_id == Customer.id)
        full_name = func.concat(Customer.first_name, ' ', func.coalesce(Customer.last_name, ''))
        search_filter = or_(
            Customer.first_name.ilike(f"%{search}%"),
            Customer.last_name.ilike(f"%{search}%"),
            full_name.ilike(f"%{search}%"),
            Customer.email.ilike(f"%{search}%"),
            Customer.phone.ilike(f"%{search}%"),
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
    current_user: User = Depends(deps.require_permission(Permission.CREATE_LEAD)),
) -> Any:
    """
    Create a new lead (sales opportunity).
    Step 1: Find or create Customer by phone/email.
    Step 2: Check for active lead for this customer in this dealership.
    Step 3: If active → bump interest_score, else create new lead.
    """
    dealership_id = lead_in.dealership_id
    assigned_to = None

    if current_user.role == UserRole.SALESPERSON:
        dealership_id = current_user.dealership_id
        assigned_to = current_user.id
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        dealership_id = current_user.dealership_id

    # Step 1: find or create customer
    customer_extra = {}
    for f in ("alternate_phone", "address", "city", "state", "postal_code", "country",
              "date_of_birth", "company", "job_title", "preferred_contact_method", "preferred_contact_time"):
        val = getattr(lead_in, f, None)
        if val is not None:
            customer_extra[f] = val

    customer, customer_created = await CustomerService.find_or_create(
        db,
        phone=lead_in.phone,
        email=lead_in.email,
        first_name=lead_in.first_name,
        last_name=lead_in.last_name,
        source=lead_in.source.value if lead_in.source else None,
        **customer_extra,
    )

    # Step 2: check for existing active lead in the same dealership
    active_query = select(Lead).where(
        Lead.customer_id == customer.id,
        Lead.is_active == True,
    )
    if dealership_id:
        active_query = active_query.where(Lead.dealership_id == dealership_id)
    active_result = await db.execute(active_query)
    existing_active_lead = active_result.scalar_one_or_none()

    if existing_active_lead:
        # Bump interest score, add activity note, return existing
        existing_active_lead.interest_score += 20
        existing_active_lead.last_activity_at = utc_now()
        source_label = lead_in.source.value if lead_in.source else "unknown"
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.NOTE_ADDED,
            description=f"Customer showed interest again via {source_label} (interest_score +20)",
            user_id=current_user.id,
            lead_id=existing_active_lead.id,
            dealership_id=existing_active_lead.dealership_id,
            meta_data={"repeat_interest": True, "source": source_label, "interest_score": existing_active_lead.interest_score},
        )
        await db.flush()
        return existing_active_lead

    # Optional secondary customer (e.g. co-buyer)
    secondary_customer_id = None
    if lead_in.secondary_customer_id:
        sec_cust = await CustomerService.get_customer(db, lead_in.secondary_customer_id)
        if not sec_cust:
            raise HTTPException(status_code=400, detail="Secondary customer not found")
        if sec_cust.id == customer.id:
            raise HTTPException(status_code=400, detail="Secondary customer cannot be the same as primary")
        secondary_customer_id = sec_cust.id

    # Step 3: create new lead
    default_stage = await LeadStageService.get_default_stage(db, dealership_id)

    lead = Lead(
        customer_id=customer.id,
        stage_id=default_stage.id,
        source=lead_in.source,
        dealership_id=dealership_id,
        assigned_to=assigned_to,
        created_by=current_user.id,
        notes=lead_in.notes,
        meta_data=lead_in.meta_data or {},
        interested_in=lead_in.interested_in,
        budget_range=lead_in.budget_range,
        secondary_customer_id=secondary_customer_id,
    )
    db.add(lead)
    await db.flush()

    # Log activity
    lead_name = customer.full_name
    if assigned_to:
        description = f"Lead created and auto-assigned to {current_user.first_name} {current_user.last_name}"
    else:
        description = f"Lead created by {current_user.email}"

    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_CREATED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=dealership_id,
    )

    if dealership_id:
        source_display = lead.source.value if lead.source else "unknown"
        background_tasks.add_task(
            notify_lead_assigned_to_dealership_background,
            lead_id=lead.id,
            lead_name=lead_name,
            dealership_id=dealership_id,
            source=source_display,
        )

    try:
        from app.services.notification_service import emit_lead_created, emit_badges_refresh
        await emit_lead_created(
            str(lead.id),
            str(dealership_id) if dealership_id else None,
            {"dealership_id": str(dealership_id) if dealership_id else None},
        )
        if lead.dealership_id is None:
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
    new_secondary_id = update_data.get("secondary_customer_id")
    new_secondary_customer = None  # reused for activity description
    if "secondary_customer_id" in update_data:
        if new_secondary_id is not None:
            new_secondary_customer = await CustomerService.get_customer(db, new_secondary_id)
            if not new_secondary_customer:
                raise HTTPException(status_code=400, detail="Secondary customer not found")
            if new_secondary_id == lead.customer_id:
                raise HTTPException(status_code=400, detail="Secondary customer cannot be the same as primary")

    # Build human-readable description (added/removed for secondary customer, "updated" for others)
    field_labels = {
        "notes": "Notes",
        "interested_in": "Interested in",
        "budget_range": "Budget range",
        "meta_data": "Metadata",
        "secondary_customer_id": "Secondary customer",
    }
    updated_fields = list(update_data.keys())
    labels = [field_labels.get(f, f.replace("_", " ").title()) for f in updated_fields]
    description_parts = []

    if "secondary_customer_id" in update_data:
        old_secondary_id = getattr(lead, "secondary_customer_id", None)
        if old_secondary_id is None and new_secondary_id is not None:
            name = f"{getattr(new_secondary_customer, 'first_name', '') or ''} {getattr(new_secondary_customer, 'last_name', '') or ''}".strip() if new_secondary_customer else "Unknown"
            description_parts.append(f"Secondary customer added: {name}")
        elif old_secondary_id is not None and new_secondary_id is None:
            description_parts.append("Secondary customer removed")
        elif old_secondary_id != new_secondary_id and new_secondary_id is not None:
            name = f"{getattr(new_secondary_customer, 'first_name', '') or ''} {getattr(new_secondary_customer, 'last_name', '') or ''}".strip() if new_secondary_customer else "Unknown"
            description_parts.append(f"Secondary customer changed to: {name}")
        else:
            description_parts.append("Secondary customer updated")

    other_fields = [f for f in updated_fields if f != "secondary_customer_id"]
    if other_fields:
        other_labels = [field_labels.get(f, f.replace("_", " ").title()) for f in other_fields]
        if len(other_labels) == 1:
            description_parts.append(f"{other_labels[0]} updated")
        elif len(other_labels) == 2:
            description_parts.append(f"{other_labels[0]} and {other_labels[1]} updated")
        else:
            description_parts.append(f"{', '.join(other_labels[:-1])}, and {other_labels[-1]} updated")

    description = ". ".join(description_parts) if description_parts else "Lead updated"

    for field, value in update_data.items():
        setattr(lead, field, value)
    
    lead.updated_at = utc_now()
    
    # Log update activity with what actually changed
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_UPDATED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "performer_name": performer_name,
            "updated_fields": updated_fields,
            "updated_fields_labels": labels,
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
    
    # Fetch customer info
    cust_result = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
    customer = cust_result.scalar_one_or_none()
    customer_brief = None
    if customer:
        customer_brief = {
            "id": customer.id,
            "first_name": customer.first_name,
            "last_name": customer.last_name,
            "full_name": customer.full_name,
            "phone": customer.phone,
            "email": customer.email,
        }

    # Fetch stage info
    stage_result = await db.execute(select(LeadStage).where(LeadStage.id == lead.stage_id))
    stage = stage_result.scalar_one_or_none()
    stage_data = None
    if stage:
        stage_data = {
            "id": stage.id,
            "name": stage.name,
            "display_name": stage.display_name,
            "order": stage.order,
            "color": stage.color,
            "dealership_id": stage.dealership_id,
            "is_terminal": stage.is_terminal,
            "is_active": stage.is_active,
            "created_at": stage.created_at,
        }

    # Secondary customer (optional)
    secondary_customer_brief = None
    if getattr(lead, "secondary_customer_id", None):
        sec_result = await db.execute(select(Customer).where(Customer.id == lead.secondary_customer_id))
        sec_cust = sec_result.scalar_one_or_none()
        if sec_cust:
            secondary_customer_brief = {
                "id": sec_cust.id,
                "first_name": sec_cust.first_name,
                "last_name": sec_cust.last_name,
                "full_name": sec_cust.full_name,
                "phone": sec_cust.phone,
                "email": sec_cust.email,
            }

    # Build response
    response_data = {
        "id": lead.id,
        "customer_id": lead.customer_id,
        "customer": customer_brief,
        "secondary_customer_id": lead.secondary_customer_id if getattr(lead, "secondary_customer_id", None) else None,
        "secondary_customer": secondary_customer_brief,
        "stage_id": lead.stage_id,
        "stage": stage_data,
        "source": lead.source,
        "is_active": lead.is_active,
        "outcome": lead.outcome,
        "interest_score": lead.interest_score,
        "dealership_id": lead.dealership_id,
        "assigned_to": lead.assigned_to,
        "secondary_salesperson_id": lead.secondary_salesperson_id,
        "created_by": lead.created_by,
        "notes": lead.notes,
        "meta_data": lead.meta_data,
        "external_id": lead.external_id,
        "interested_in": lead.interested_in,
        "budget_range": lead.budget_range,
        "first_contacted_at": lead.first_contacted_at,
        "last_contacted_at": lead.last_contacted_at,
        "converted_at": lead.converted_at,
        "closed_at": lead.closed_at,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
        "assigned_to_user": None,
        "secondary_salesperson": None,
        "created_by_user": None,
        "dealership": None,
        "access_level": access_level,
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
    
    # Fetch secondary salesperson info
    if lead.secondary_salesperson_id:
        sec_result = await db.execute(select(User).where(User.id == lead.secondary_salesperson_id))
        secondary_user = sec_result.scalar_one_or_none()
        if secondary_user:
            response_data["secondary_salesperson"] = {
                "id": secondary_user.id,
                "email": secondary_user.email,
                "first_name": secondary_user.first_name,
                "last_name": secondary_user.last_name,
                "role": secondary_user.role,
                "is_active": secondary_user.is_active,
                "dealership_id": secondary_user.dealership_id
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


@router.post("/{lead_id}/stage", response_model=LeadResponse)
async def update_lead_stage(
    lead_id: UUID,
    stage_in: LeadStageChangeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Change lead's pipeline stage. If new stage is terminal, close the lead.
    """
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # SKATE check
    skate_info = await check_skate_condition(db, current_user, lead, "stage change")
    is_skate_action = False
    if skate_info:
        if not stage_in.confirm_skate:
            return JSONResponse(status_code=200, content=skate_info)
        else:
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
                    action="changed stage",
                    performer_user_id=current_user.id,
                )

    # Access check
    is_unassigned_pool = lead.dealership_id is None
    if not is_unassigned_pool:
        has_access = (
            current_user.role == UserRole.SUPER_ADMIN
            or (current_user.role == UserRole.SALESPERSON and (lead.assigned_to == current_user.id or lead.dealership_id == current_user.dealership_id))
            or (current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER] and lead.dealership_id == current_user.dealership_id)
        )
        if not has_access:
            raise HTTPException(status_code=403, detail="Not authorized to update this lead")

    # Fetch new stage
    new_stage = await LeadStageService.get_stage(db, stage_in.stage_id)
    if not new_stage:
        raise HTTPException(status_code=404, detail="Stage not found")

    # Salesperson cannot move to terminal (converted/lost) stages
    if new_stage.is_terminal and current_user.role == UserRole.SALESPERSON:
        raise HTTPException(status_code=403, detail="Only admins or owners can close leads")

    notification_service = NotificationService(db)
    await auto_assign_lead_on_activity(db, lead, current_user, "stage_change", notification_service)

    # Fetch old stage name for logging
    old_stage = await LeadStageService.get_stage(db, lead.stage_id)
    old_stage_name = old_stage.display_name if old_stage else "?"

    lead.stage_id = new_stage.id
    lead.stage = new_stage  # So response serializes the new stage, not the cached old one
    lead.last_activity_at = utc_now()

    # Terminal stage handling
    if new_stage.is_terminal:
        lead.is_active = False
        lead.closed_at = utc_now()
        if new_stage.name == "converted":
            lead.outcome = "converted"
            lead.converted_at = utc_now()
            # Update customer lifetime value
            cust = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
            customer = cust.scalar_one_or_none()
            if customer:
                customer.lifetime_value += 1  # Placeholder — real value from deal
        elif new_stage.name == "lost":
            lead.outcome = "lost"
        else:
            lead.outcome = new_stage.name

    performer_name = f"{current_user.first_name} {current_user.last_name}"
    await ActivityService.log_lead_status_change(
        db,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        old_status=old_stage_name,
        new_status=new_stage.display_name,
        performer_name=performer_name,
        notes=stage_in.notes,
        is_skate_action=is_skate_action,
    )

    await db.flush()

    try:
        from app.services.notification_service import emit_lead_updated, emit_stats_refresh, emit_activity_added
        await emit_lead_updated(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            "stage_changed",
            {"stage_id": str(new_stage.id), "stage_name": new_stage.display_name, "old_stage": old_stage_name},
        )
        await emit_activity_added(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            {"type": "stage_changed", "performer_name": performer_name, "old_stage": old_stage_name, "new_stage": new_stage.display_name, "timestamp": utc_now().isoformat()},
        )
        await emit_stats_refresh(str(lead.dealership_id) if lead.dealership_id else None)
    except Exception as e:
        logger.error(f"Failed to emit WebSocket events: {e}")

    return lead


# Legacy compat: keep /status endpoint that delegates to /stage
@router.post("/{lead_id}/status", response_model=LeadResponse)
async def update_lead_status_compat(
    lead_id: UUID,
    body: LeadStatusUpdateCompat,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Legacy /status endpoint — accepts JSON body with status name or stage_id, delegates to stage change."""
    if body.stage_id:
        target_stage_id = body.stage_id
    elif body.status:
        # Resolve stage by name; use lead's dealership so dealership-specific stages (e.g. "converted") are found
        lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
        lead = lead_result.scalar_one_or_none()
        dealership_id = lead.dealership_id if lead else current_user.dealership_id
        stage = await LeadStageService.get_stage_by_name(db, body.status, dealership_id)
        if not stage:
            raise HTTPException(status_code=400, detail=f"Unknown stage name: {body.status}")
        target_stage_id = stage.id
    else:
        raise HTTPException(status_code=400, detail="Provide stage_id or status")
    req = LeadStageChangeRequest(stage_id=target_stage_id, notes=body.notes, confirm_skate=body.confirm_skate)
    return await update_lead_stage(lead_id, req, background_tasks, db, current_user)


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
    
    # Handle optional secondary salesperson assignment (for admins)
    secondary_user = None
    if assign_in.secondary_salesperson_id:
        if current_user.role in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
            sec_result = await db.execute(select(User).where(User.id == assign_in.secondary_salesperson_id))
            secondary_user = sec_result.scalar_one_or_none()
            if secondary_user:
                if assign_in.secondary_salesperson_id != assign_in.assigned_to:
                    lead.secondary_salesperson_id = assign_in.secondary_salesperson_id
    
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
        _cust = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
        _c = _cust.scalar_one_or_none()
        lead_name = _c.full_name if _c else "Lead"
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
        # Emit activity event for real-time timeline update
        from app.services.notification_service import emit_activity_added
        await emit_activity_added(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            {
                "type": "lead_assigned",
                "performer_name": performer_name,
                "assigned_to_name": assigned_to_name,
                "is_reassignment": is_reassignment,
                "timestamp": utc_now().isoformat(),
            }
        )
    except Exception as e:
        logger.error(f"Failed to emit WebSocket events: {e}")
    
    return lead


@router.patch("/{lead_id}/assign-secondary", response_model=LeadResponse)
async def assign_secondary_salesperson(
    lead_id: UUID,
    assign_in: LeadSecondaryAssignment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_SALESPERSON))
) -> Any:
    """
    Assign or remove secondary salesperson (Admin only).
    Set secondary_salesperson_id to null to remove.
    """
    # Only admins can assign secondary
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can assign secondary salesperson")
    
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Verify secondary user exists if provided
    secondary_user = None
    if assign_in.secondary_salesperson_id:
        user_result = await db.execute(select(User).where(User.id == assign_in.secondary_salesperson_id))
        secondary_user = user_result.scalar_one_or_none()
        
        if not secondary_user:
            raise HTTPException(status_code=404, detail="Secondary salesperson not found")
        
        # Verify same dealership (unless super admin)
        if current_user.role != UserRole.SUPER_ADMIN:
            if secondary_user.dealership_id != current_user.dealership_id:
                raise HTTPException(status_code=400, detail="Cannot assign user from different dealership")
        
        # Cannot be same as primary
        if lead.assigned_to and lead.assigned_to == assign_in.secondary_salesperson_id:
            raise HTTPException(status_code=400, detail="Secondary cannot be same as primary salesperson")
    
    old_secondary_id = lead.secondary_salesperson_id
    lead.secondary_salesperson_id = assign_in.secondary_salesperson_id
    
    # Log activity
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    if secondary_user:
        secondary_name = f"{secondary_user.first_name} {secondary_user.last_name}"
        description = f"Secondary salesperson set to {secondary_name} by {performer_name}"
    else:
        description = f"Secondary salesperson removed by {performer_name}"
    
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_ASSIGNED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "secondary_salesperson_id": str(assign_in.secondary_salesperson_id) if assign_in.secondary_salesperson_id else None,
            "old_secondary_salesperson_id": str(old_secondary_id) if old_secondary_id else None,
            "action": "assign_secondary",
            "notes": assign_in.notes
        }
    )
    
    await db.commit()
    await db.refresh(lead)
    try:
        from app.services.notification_service import emit_lead_updated, emit_badges_refresh, emit_stats_refresh
        await emit_lead_updated(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            "assigned",
            {"action": "assign_secondary"},
        )
    except Exception:
        pass
    return lead


@router.post("/{lead_id}/swap-salespersons", response_model=LeadResponse)
async def swap_salespersons(
    lead_id: UUID,
    swap_in: LeadSwapSalespersons,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.ASSIGN_LEAD_TO_SALESPERSON))
) -> Any:
    """
    Swap primary and secondary salespersons.
    Only works if both are assigned.
    """
    # Only admins can swap
    if current_user.role not in [UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        raise HTTPException(status_code=403, detail="Only admins can swap salespersons")
    
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if not lead.assigned_to or not lead.secondary_salesperson_id:
        raise HTTPException(status_code=400, detail="Both primary and secondary must be assigned to swap")
    
    # Swap
    old_primary = lead.assigned_to
    old_secondary = lead.secondary_salesperson_id
    lead.assigned_to = old_secondary
    lead.secondary_salesperson_id = old_primary
    
    # Get names for logging
    primary_result = await db.execute(select(User).where(User.id == old_primary))
    primary_user = primary_result.scalar_one_or_none()
    secondary_result = await db.execute(select(User).where(User.id == old_secondary))
    secondary_user = secondary_result.scalar_one_or_none()
    
    primary_name = f"{primary_user.first_name} {primary_user.last_name}" if primary_user else "Unknown"
    secondary_name = f"{secondary_user.first_name} {secondary_user.last_name}" if secondary_user else "Unknown"
    performer_name = f"{current_user.first_name} {current_user.last_name}"
    
    description = f"Salespersons swapped: {secondary_name} is now primary, {primary_name} is now secondary (by {performer_name})"
    
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_ASSIGNED,
        description=description,
        user_id=current_user.id,
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "action": "swap_salespersons",
            "old_primary": str(old_primary),
            "old_secondary": str(old_secondary),
            "new_primary": str(old_secondary),
            "new_secondary": str(old_primary),
            "notes": swap_in.notes
        }
    )
    
    await db.commit()
    await db.refresh(lead)
    try:
        from app.services.notification_service import emit_lead_updated, emit_badges_refresh, emit_stats_refresh
        await emit_lead_updated(
            str(lead.id),
            str(lead.dealership_id) if lead.dealership_id else None,
            "assigned",
            {"action": "swap_salespersons"},
        )
    except Exception:
        pass
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
    _c_obj = (await db.execute(select(Customer).where(Customer.id == lead.customer_id))).scalar_one_or_none()
    lead_name = _c_obj.full_name if _c_obj else "Lead"
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
        _bc = (await db.execute(select(Customer).where(Customer.id == lead.customer_id))).scalar_one_or_none()
        lead_name = _bc.full_name if _bc else "Lead"

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

    try:
        from app.services.notification_service import emit_badges_refresh, emit_stats_refresh
        await emit_badges_refresh(unassigned=True)
        await emit_stats_refresh(str(assignment_in.dealership_id))
    except Exception:
        pass

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
    await auto_assign_lead_on_activity(
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
        _mc = (await db.execute(select(Customer).where(Customer.id == lead.customer_id))).scalar_one_or_none()
        lead_name = _mc.full_name if _mc else "Lead"
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
                    },
                    send_push=True,
                    send_email=True,
                    send_sms=True,
                )
        # Emit badge refresh for mentioned users
        from app.services.notification_service import emit_badges_refresh
        await emit_badges_refresh(notifications=True)
    
    # ALWAYS emit WebSocket event for real-time timeline update (not just for mentions)
    from app.services.notification_service import emit_activity_added
    await emit_activity_added(
        str(lead.id),
        str(lead.dealership_id) if lead.dealership_id else None,
        {
            "activity_id": str(note_activity.id),
            "type": "note_added",
            "performer_name": performer_name,
            "content_preview": note_in.content[:100] if note_in.content else "",
            "has_mentions": bool(note_in.mentioned_user_ids),
            "is_reply": note_in.parent_id is not None,
            "timestamp": utc_now().isoformat(),
        }
    )
    
    await db.flush()
    return lead


# ----- Stips documents (lead/customer-scoped) -----
@router.get("/{lead_id}/stips/documents", response_model=List[StipDocumentResponse])
async def list_lead_stips_documents(
    lead_id: UUID,
    category_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """List Stips documents for this lead (customer- and lead-scoped by category)."""
    lead = await _lead_access(db, lead_id, current_user)
    items = await list_documents_for_lead(db, lead_id, lead, category_id=category_id)
    return items


@router.post("/{lead_id}/stips/documents", response_model=StipDocumentResponse)
async def upload_lead_stip_document(
    lead_id: UUID,
    file: UploadFile = File(...),
    stips_category_id: UUID = Query(..., alias="stips_category_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Upload a Stips document for this lead (category determines customer vs lead scope)."""
    lead = await _lead_access(db, lead_id, current_user)
    if not app_settings.is_azure_stips_configured:
        raise HTTPException(status_code=503, detail="Stips storage is not configured")
    data = await file.read()
    doc = await upload_document_for_lead(
        db,
        lead=lead,
        category_id=stips_category_id,
        file_name=file.filename or "file",
        data=data,
        content_type=file.content_type or "application/octet-stream",
        uploaded_by=current_user.id,
    )
    performer_name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or current_user.email or "Someone"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.STIP_DOCUMENT_ADDED,
        description=f"Document added to {doc['category_name']}: {doc['file_name']} by {performer_name}",
        user_id=current_user.id,
        lead_id=lead_id,
        dealership_id=lead.dealership_id,
        meta_data={"category_name": doc["category_name"], "file_name": doc["file_name"]},
    )
    await db.commit()
    return doc


@router.delete("/{lead_id}/stips/documents/{document_id}")
async def delete_lead_stip_document(
    lead_id: UUID,
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Remove a Stips document (must belong to this lead via customer or lead)."""
    lead = await _lead_access(db, lead_id, current_user)
    doc_info = await get_document_info_for_lead(db, document_id, lead)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document not found or not accessible")
    file_name, category_name = doc_info
    deleted = await delete_document_for_lead(db, document_id, lead)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found or not accessible")
    performer_name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or current_user.email or "Someone"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.STIP_DOCUMENT_REMOVED,
        description=f"Document removed from {category_name}: {file_name} by {performer_name}",
        user_id=current_user.id,
        lead_id=lead_id,
        dealership_id=lead.dealership_id,
        meta_data={"category_name": category_name, "file_name": file_name},
    )
    await db.commit()
    return {"message": "Document deleted"}


@router.get("/{lead_id}/stips/documents/{document_id}/view", response_model=StipDocumentViewUrl)
async def view_lead_stip_document(
    lead_id: UUID,
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Get a temporary SAS URL to view the document (open in new tab)."""
    lead = await _lead_access(db, lead_id, current_user)
    blob_path, _ = await resolve_document_for_lead(db, document_id, lead)
    if not blob_path:
        raise HTTPException(status_code=404, detail="Document not found or not accessible")
    if not app_settings.is_azure_stips_configured:
        raise HTTPException(status_code=503, detail="Stips storage is not configured")
    url = azure_storage_service.get_stip_document_secure_url(blob_path, expiry_hours=1)
    if not url:
        raise HTTPException(status_code=503, detail="Could not generate view URL")
    return StipDocumentViewUrl(url=url)


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
    
    # Emit WebSocket event for real-time timeline update
    from app.services.notification_service import emit_activity_added
    await emit_activity_added(
        str(lead.id),
        str(lead.dealership_id) if lead.dealership_id else None,
        {
            "type": "call_logged",
            "performer_name": performer_name,
            "outcome": call_in.outcome,
            "timestamp": utc_now().isoformat(),
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
    _dc = (await db.execute(select(Customer).where(Customer.id == lead.customer_id))).scalar_one_or_none()
    lead_name = _dc.full_name if _dc else "Lead"
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
            "lead_email": _dc.email if _dc else None,
            "lead_phone": _dc.phone if _dc else None,
            "performer_name": performer_name,
            "deleted_at": utc_now().isoformat(),
        },
    )
    
    dealership_id_str = str(lead.dealership_id) if lead.dealership_id else None
    # Delete the lead
    await db.delete(lead)
    await db.commit()

    # Emit real-time updates so sidebar and dashboard refresh
    try:
        from app.services.notification_service import emit_badges_refresh, emit_stats_refresh
        await emit_badges_refresh(unassigned=True)
        await emit_stats_refresh(dealership_id_str)
    except Exception:
        pass

    return {
        "message": f"Lead '{lead_name}' deleted successfully",
        "lead_id": str(lead_id)
    }


@router.get("/export/csv")
async def export_leads_csv(
    include_activities: bool = Query(False, description="Include activity history"),
    include_appointments: bool = Query(False, description="Include appointments"),
    include_notes: bool = Query(False, description="Include notes in export"),
    status: Optional[str] = Query(None, description="Filter by stage name"),
    source: Optional[LeadSource] = Query(None, description="Filter by source"),
    date_from: Optional[datetime] = Query(None, description="Filter by created date from"),
    date_to: Optional[datetime] = Query(None, description="Filter by created date to"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Export leads to CSV with optional detailed data.
    - Basic export: lead info only
    - Detailed export: includes activities, appointments, notes
    """
    import csv
    from io import StringIO
    from fastapi.responses import StreamingResponse
    from app.models.activity import Activity
    from app.models.appointment import Appointment
    
    # Build query based on user role
    query = select(Lead)
    
    if current_user.role == UserRole.SALESPERSON:
        # Salesperson sees only their leads
        query = query.where(
            (Lead.assigned_to == current_user.id) | 
            (Lead.secondary_salesperson_id == current_user.id)
        )
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        # Dealership staff sees only their dealership leads
        if current_user.dealership_id:
            query = query.where(Lead.dealership_id == current_user.dealership_id)
    # Super admin sees all
    
    # Apply filters (status is now a stage name for backward compat)
    if status:
        _stage = await LeadStageService.get_stage_by_name(db, status)
        if _stage:
            query = query.where(Lead.stage_id == _stage.id)
    if source:
        query = query.where(Lead.source == source)
    if date_from:
        query = query.where(Lead.created_at >= date_from)
    if date_to:
        query = query.where(Lead.created_at <= date_to)
    
    query = query.order_by(Lead.created_at.desc())
    
    result = await db.execute(query)
    leads = result.scalars().all()
    
    # Prepare CSV output
    output = StringIO()
    
    # Build header based on options
    headers = [
        "ID", "First Name", "Last Name", "Email", "Phone",
        "Status", "Source", "Created At", "Last Contacted",
        "Dealership ID", "Assigned To ID", "Secondary Salesperson ID",
        "Converted At", "Notes"
    ]
    
    if include_activities:
        headers.extend(["Activity Count", "Last Activity"])
    if include_appointments:
        headers.extend(["Appointment Count", "Next Appointment"])
    
    writer = csv.writer(output)
    writer.writerow(headers)
    
    # Fetch additional data if needed
    lead_ids = [lead.id for lead in leads]
    
    activity_counts = {}
    last_activities = {}
    if include_activities and lead_ids:
        activity_query = select(
            Activity.lead_id,
            func.count(Activity.id).label("count"),
            func.max(Activity.created_at).label("last")
        ).where(Activity.lead_id.in_(lead_ids)).group_by(Activity.lead_id)
        activity_result = await db.execute(activity_query)
        for row in activity_result.all():
            activity_counts[row.lead_id] = row.count
            last_activities[row.lead_id] = row.last
    
    appointment_counts = {}
    next_appointments = {}
    if include_appointments and lead_ids:
        from sqlalchemy import case
        appt_query = select(
            Appointment.lead_id,
            func.count(Appointment.id).label("count"),
            func.min(case((Appointment.scheduled_at > utc_now(), Appointment.scheduled_at))).label("next")
        ).where(Appointment.lead_id.in_(lead_ids)).group_by(Appointment.lead_id)
        appt_result = await db.execute(appt_query)
        for row in appt_result.all():
            appointment_counts[row.lead_id] = row.count
            next_appointments[row.lead_id] = row.next
    
    # Pre-fetch customers and stages for CSV
    cust_ids = {l.customer_id for l in leads if l.customer_id}
    stage_ids_csv = {l.stage_id for l in leads if l.stage_id}
    csv_custs = {}
    if cust_ids:
        cr = await db.execute(select(Customer).where(Customer.id.in_(cust_ids)))
        for c in cr.scalars().all():
            csv_custs[c.id] = c
    csv_stages = {}
    if stage_ids_csv:
        sr = await db.execute(select(LeadStage).where(LeadStage.id.in_(stage_ids_csv)))
        for s in sr.scalars().all():
            csv_stages[s.id] = s

    # Write data rows
    for lead in leads:
        _cc = csv_custs.get(lead.customer_id)
        _ss = csv_stages.get(lead.stage_id)
        row = [
            str(lead.id),
            _cc.first_name if _cc else "",
            _cc.last_name or "" if _cc else "",
            _cc.email or "" if _cc else "",
            _cc.phone or "" if _cc else "",
            _ss.display_name if _ss else "",
            lead.source.value if lead.source else "",
            lead.created_at.isoformat() if lead.created_at else "",
            lead.last_contacted_at.isoformat() if lead.last_contacted_at else "",
            str(lead.dealership_id) if lead.dealership_id else "",
            str(lead.assigned_to) if lead.assigned_to else "",
            str(lead.secondary_salesperson_id) if lead.secondary_salesperson_id else "",
            lead.converted_at.isoformat() if lead.converted_at else "",
            lead.notes or "" if include_notes else ""
        ]
        
        if include_activities:
            row.append(str(activity_counts.get(lead.id, 0)))
            last_act = last_activities.get(lead.id)
            row.append(last_act.isoformat() if last_act else "")
        
        if include_appointments:
            row.append(str(appointment_counts.get(lead.id, 0)))
            next_appt = next_appointments.get(lead.id)
            row.append(next_appt.isoformat() if next_appt else "")
        
        writer.writerow(row)
    
    output.seek(0)
    
    # Generate filename with timestamp
    filename = f"leads_export_{utc_now().strftime('%Y%m%d_%H%M%S')}.csv"
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
