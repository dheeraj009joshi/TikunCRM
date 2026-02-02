"""
Dashboard Intelligence Endpoints
"""
from typing import Any, Dict, List, Optional
from uuid import UUID
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.lead import Lead, LeadStatus, LeadSource
from app.models.dealership import Dealership
from app.models.user import User
from app.models.activity import Activity
from app.models.follow_up import FollowUp, FollowUpStatus

router = APIRouter()


# Response schemas
class SuperAdminStats(BaseModel):
    total_leads: int
    unassigned_leads: int
    total_dealerships: int
    active_dealerships: int
    conversion_rate: str
    total_salesforce: int
    leads_change: str
    conversion_change: str
    dealerships_change: str
    salesforce_change: str


class DealershipPerformance(BaseModel):
    id: UUID
    name: str
    total_leads: int
    converted_leads: int
    conversion_rate: float
    active_leads: int
    avg_response_time: Optional[str] = None


class DealershipAdminStats(BaseModel):
    total_leads: int
    unassigned_to_salesperson: int
    active_leads: int
    converted_leads: int
    conversion_rate: str
    team_size: int
    pending_follow_ups: int
    overdue_follow_ups: int


class SalespersonStats(BaseModel):
    total_leads: int
    active_leads: int
    converted_leads: int
    lost_leads: int
    conversion_rate: str
    todays_follow_ups: int
    overdue_follow_ups: int
    leads_by_status: Dict[str, int]


class LeadsBySource(BaseModel):
    source: str
    count: int
    percentage: float


class LeadsByStatus(BaseModel):
    status: str
    count: int
    percentage: float


@router.get("/super-admin/stats", response_model=SuperAdminStats)
async def get_super_admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_SYSTEM_REPORTS))
) -> Any:
    """Get global statistics for Super Admin dashboard"""
    # Count total leads
    total_leads_result = await db.execute(select(func.count()).select_from(Lead))
    total_leads = total_leads_result.scalar() or 0
    
    # Count unassigned leads (not assigned to any dealership)
    unassigned_result = await db.execute(
        select(func.count()).select_from(Lead).where(Lead.dealership_id.is_(None))
    )
    unassigned_leads = unassigned_result.scalar() or 0
    
    # Count dealerships
    total_dealers_result = await db.execute(select(func.count()).select_from(Dealership))
    total_dealers = total_dealers_result.scalar() or 0
    
    # Count active dealerships
    active_dealers_result = await db.execute(
        select(func.count()).select_from(Dealership).where(Dealership.is_active == True)
    )
    active_dealers = active_dealers_result.scalar() or 0
    
    # Conversion rate
    converted_result = await db.execute(
        select(func.count()).select_from(Lead).where(Lead.status == LeadStatus.CONVERTED)
    )
    total_converted = converted_result.scalar() or 0
    conversion_rate = (total_converted / total_leads * 100) if total_leads > 0 else 0
    
    # Total sales force
    total_sales_result = await db.execute(
        select(func.count()).select_from(User).where(
            and_(User.role == UserRole.SALESPERSON, User.is_active == True)
        )
    )
    total_sales = total_sales_result.scalar() or 0
    
    return SuperAdminStats(
        total_leads=total_leads,
        unassigned_leads=unassigned_leads,
        total_dealerships=total_dealers,
        active_dealerships=active_dealers,
        conversion_rate=f"{conversion_rate:.1f}%",
        total_salesforce=total_sales,
        leads_change="+5.2%",  # TODO: Calculate from historical data
        conversion_change="+1.1%",
        dealerships_change=f"+{total_dealers - active_dealers}" if total_dealers > active_dealers else "0",
        salesforce_change="+8"
    )


@router.get("/super-admin/dealership-performance", response_model=List[DealershipPerformance])
async def get_dealership_performance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_SYSTEM_REPORTS)),
    limit: int = 10
) -> Any:
    """Get performance metrics for all dealerships"""
    # Get all active dealerships
    dealerships_result = await db.execute(
        select(Dealership).where(Dealership.is_active == True).limit(limit)
    )
    dealerships = dealerships_result.scalars().all()
    
    performance_data = []
    for dealership in dealerships:
        # Total leads for this dealership
        total_result = await db.execute(
            select(func.count()).select_from(Lead).where(Lead.dealership_id == dealership.id)
        )
        total_leads = total_result.scalar() or 0
        
        # Converted leads
        converted_result = await db.execute(
            select(func.count()).select_from(Lead).where(
                and_(Lead.dealership_id == dealership.id, Lead.status == LeadStatus.CONVERTED)
            )
        )
        converted_leads = converted_result.scalar() or 0
        
        # Active leads (not converted or lost)
        active_result = await db.execute(
            select(func.count()).select_from(Lead).where(
                and_(
                    Lead.dealership_id == dealership.id,
                    Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.FOLLOW_UP, LeadStatus.INTERESTED])
                )
            )
        )
        active_leads = active_result.scalar() or 0
        
        conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0
        
        performance_data.append(DealershipPerformance(
            id=dealership.id,
            name=dealership.name,
            total_leads=total_leads,
            converted_leads=converted_leads,
            conversion_rate=round(conversion_rate, 1),
            active_leads=active_leads
        ))
    
    # Sort by conversion rate descending
    performance_data.sort(key=lambda x: x.conversion_rate, reverse=True)
    
    return performance_data


@router.get("/super-admin/leads-by-source", response_model=List[LeadsBySource])
async def get_leads_by_source(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_SYSTEM_REPORTS))
) -> Any:
    """Get lead distribution by source"""
    total_result = await db.execute(select(func.count()).select_from(Lead))
    total_leads = total_result.scalar() or 0
    
    source_data = []
    for source in LeadSource:
        count_result = await db.execute(
            select(func.count()).select_from(Lead).where(Lead.source == source)
        )
        count = count_result.scalar() or 0
        percentage = (count / total_leads * 100) if total_leads > 0 else 0
        
        source_data.append(LeadsBySource(
            source=source.value,
            count=count,
            percentage=round(percentage, 1)
        ))
    
    return source_data


@router.get("/dealership-admin/stats", response_model=DealershipAdminStats)
async def get_dealership_admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_DEALERSHIP_REPORTS))
) -> Any:
    """Get statistics for Dealership Admin dashboard"""
    dealership_id = current_user.dealership_id
    if not dealership_id:
        raise HTTPException(status_code=400, detail="User not associated with a dealership")
    
    # Total leads for dealership
    total_result = await db.execute(
        select(func.count()).select_from(Lead).where(Lead.dealership_id == dealership_id)
    )
    total_leads = total_result.scalar() or 0
    
    # Unassigned to salesperson
    unassigned_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(Lead.dealership_id == dealership_id, Lead.assigned_to.is_(None))
        )
    )
    unassigned_leads = unassigned_result.scalar() or 0
    
    # Active leads
    active_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(
                Lead.dealership_id == dealership_id,
                Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.FOLLOW_UP, LeadStatus.INTERESTED])
            )
        )
    )
    active_leads = active_result.scalar() or 0
    
    # Converted leads
    converted_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(Lead.dealership_id == dealership_id, Lead.status == LeadStatus.CONVERTED)
        )
    )
    converted_leads = converted_result.scalar() or 0
    
    conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0
    
    # Team size
    team_result = await db.execute(
        select(func.count()).select_from(User).where(
            and_(
                User.dealership_id == dealership_id,
                User.role == UserRole.SALESPERSON,
                User.is_active == True
            )
        )
    )
    team_size = team_result.scalar() or 0
    
    # Get team member IDs for follow-up filtering
    team_ids_result = await db.execute(
        select(User.id).where(
            and_(User.dealership_id == dealership_id, User.is_active == True)
        )
    )
    team_ids = [row[0] for row in team_ids_result.fetchall()]
    
    # Follow-ups due today
    today = datetime.utcnow().date()
    pending_followups_result = await db.execute(
        select(func.count()).select_from(FollowUp).where(
            and_(
                FollowUp.assigned_to.in_(team_ids),
                FollowUp.status == FollowUpStatus.PENDING,
                func.date(FollowUp.scheduled_at) == today
            )
        )
    )
    pending_follow_ups = pending_followups_result.scalar() or 0
    
    # Overdue follow-ups
    overdue_result = await db.execute(
        select(func.count()).select_from(FollowUp).where(
            and_(
                FollowUp.assigned_to.in_(team_ids),
                FollowUp.status == FollowUpStatus.PENDING,
                FollowUp.scheduled_at < datetime.utcnow()
            )
        )
    )
    overdue_follow_ups = overdue_result.scalar() or 0
    
    return DealershipAdminStats(
        total_leads=total_leads,
        unassigned_to_salesperson=unassigned_leads,
        active_leads=active_leads,
        converted_leads=converted_leads,
        conversion_rate=f"{conversion_rate:.1f}%",
        team_size=team_size,
        pending_follow_ups=pending_follow_ups,
        overdue_follow_ups=overdue_follow_ups
    )


@router.get("/salesperson/stats", response_model=SalespersonStats)
async def get_salesperson_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """Get statistics for Salesperson dashboard"""
    user_id = current_user.id
    
    # Total assigned leads
    total_result = await db.execute(
        select(func.count()).select_from(Lead).where(Lead.assigned_to == user_id)
    )
    total_leads = total_result.scalar() or 0
    
    # Leads by status
    leads_by_status = {}
    for status in LeadStatus:
        count_result = await db.execute(
            select(func.count()).select_from(Lead).where(
                and_(Lead.assigned_to == user_id, Lead.status == status)
            )
        )
        leads_by_status[status.value] = count_result.scalar() or 0
    
    active_leads = sum([
        leads_by_status.get(LeadStatus.NEW.value, 0),
        leads_by_status.get(LeadStatus.CONTACTED.value, 0),
        leads_by_status.get(LeadStatus.FOLLOW_UP.value, 0),
        leads_by_status.get(LeadStatus.INTERESTED.value, 0)
    ])
    
    converted_leads = leads_by_status.get(LeadStatus.CONVERTED.value, 0)
    lost_leads = leads_by_status.get(LeadStatus.LOST.value, 0)
    
    conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0
    
    # Today's follow-ups
    today = datetime.utcnow().date()
    todays_followups_result = await db.execute(
        select(func.count()).select_from(FollowUp).where(
            and_(
                FollowUp.assigned_to == user_id,
                FollowUp.status == FollowUpStatus.PENDING,
                func.date(FollowUp.scheduled_at) == today
            )
        )
    )
    todays_follow_ups = todays_followups_result.scalar() or 0
    
    # Overdue follow-ups
    overdue_result = await db.execute(
        select(func.count()).select_from(FollowUp).where(
            and_(
                FollowUp.assigned_to == user_id,
                FollowUp.status == FollowUpStatus.PENDING,
                FollowUp.scheduled_at < datetime.utcnow()
            )
        )
    )
    overdue_follow_ups = overdue_result.scalar() or 0
    
    return SalespersonStats(
        total_leads=total_leads,
        active_leads=active_leads,
        converted_leads=converted_leads,
        lost_leads=lost_leads,
        conversion_rate=f"{conversion_rate:.1f}%",
        todays_follow_ups=todays_follow_ups,
        overdue_follow_ups=overdue_follow_ups,
        leads_by_status=leads_by_status
    )


@router.get("/stats")
async def get_role_based_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Universal endpoint that returns appropriate stats based on user role.
    Automatically detects role and returns relevant dashboard data.
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        return await get_super_admin_stats(db, current_user)
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        return await get_dealership_admin_stats(db, current_user)
    else:
        return await get_salesperson_stats(db, current_user)
