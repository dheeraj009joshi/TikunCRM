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
from app.core.access_scope import get_accessible_dealership_ids
from app.core.cache import cache_get, cache_set
from app.core.config import settings
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.lead import Lead, LeadSource
from app.models.lead_stage import LeadStage
from app.services.lead_stage_service import LeadStageService
from app.models.dealership import Dealership
from app.models.user import User
from app.models.activity import Activity
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.appointment import Appointment, AppointmentStatus

router = APIRouter()

_DASHBOARD_TTL = settings.dashboard_cache_ttl_seconds


def _scope_cache_key(accessible_ids: Optional[List[UUID]]) -> str:
    if accessible_ids is None:
        return "all"
    return ",".join(sorted(str(i) for i in accessible_ids))


def _lead_dealership_clause(accessible_ids: Optional[List[UUID]]):
    """SQLAlchemy filter for Lead.dealership_id based on access scope."""
    if accessible_ids is None:
        return None  # unrestricted (single-org admin/manager/BDC)
    if not accessible_ids:
        return Lead.id.is_(None)
    return Lead.dealership_id.in_(accessible_ids)


def _user_dealership_clause(accessible_ids: Optional[List[UUID]]):
    """SQLAlchemy filter for User.dealership_id based on access scope."""
    if accessible_ids is None:
        return None
    if not accessible_ids:
        return User.id.is_(None)
    return User.dealership_id.in_(accessible_ids)


def _appointment_dealership_clause(accessible_ids: Optional[List[UUID]]):
    if accessible_ids is None:
        return None
    if not accessible_ids:
        return Appointment.id.is_(None)
    return Appointment.dealership_id.in_(accessible_ids)


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
    fresh_leads: int  # Leads with no activity except creation (untouched)


class BdcDealershipBreakdown(BaseModel):
    id: UUID
    name: str
    total_leads: int
    unassigned_leads: int
    overdue_follow_ups: int = 0
    todays_follow_ups: int = 0
    fresh_leads: int = 0


class BdcStats(BaseModel):
    total_leads: int
    active_leads: int
    unassigned_to_salesperson: int
    converted_leads: int
    conversion_rate: str
    todays_follow_ups: int
    overdue_follow_ups: int
    upcoming_appointments: int
    fresh_leads: int = 0
    dealership_count: int
    dealerships: List[BdcDealershipBreakdown]


class SalespersonStats(BaseModel):
    total_leads: int
    active_leads: int
    converted_leads: int
    lost_leads: int
    conversion_rate: str
    todays_follow_ups: int
    overdue_follow_ups: int
    leads_by_status: Dict[str, int]
    fresh_leads: int  # Leads with no activity except creation (untouched)


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
    cache_key = f"dash:super-admin:stats:{current_user.id}"

    async def _build():
        total_leads_result = await db.execute(select(func.count()).select_from(Lead))
        total_leads = total_leads_result.scalar() or 0

        unassigned_result = await db.execute(
            select(func.count()).select_from(Lead).where(Lead.dealership_id.is_(None))
        )
        unassigned_leads = unassigned_result.scalar() or 0

        total_dealers_result = await db.execute(select(func.count()).select_from(Dealership))
        total_dealers = total_dealers_result.scalar() or 0

        active_dealers_result = await db.execute(
            select(func.count()).select_from(Dealership).where(Dealership.is_active == True)
        )
        active_dealers = active_dealers_result.scalar() or 0

        converted_result = await db.execute(
            select(func.count()).select_from(Lead).where(Lead.outcome == "converted")
        )
        total_converted = converted_result.scalar() or 0
        conversion_rate = (total_converted / total_leads * 100) if total_leads > 0 else 0

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
            leads_change="+5.2%",
            conversion_change="+1.1%",
            dealerships_change=f"+{total_dealers - active_dealers}" if total_dealers > active_dealers else "0",
            salesforce_change="+8",
        )

    cached = await cache_get(cache_key)
    if cached is not None:
        return SuperAdminStats(**cached)
    result = await _build()
    await cache_set(cache_key, result.model_dump(mode="json"), _DASHBOARD_TTL)
    return result


@router.get("/super-admin/dealership-performance", response_model=List[DealershipPerformance])
async def get_dealership_performance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_SYSTEM_REPORTS)),
    limit: int = 10
) -> Any:
    """Get performance metrics for all dealerships"""
    cache_key = f"dash:super-admin:dealer-perf:{current_user.id}:{limit}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return [DealershipPerformance(**row) for row in cached]

    stats_result = await db.execute(
        select(
            Dealership.id,
            Dealership.name,
            func.count(Lead.id).label("total_leads"),
            func.count().filter(Lead.outcome == "converted").label("converted_leads"),
            func.count().filter(Lead.is_active == True).label("active_leads"),
        )
        .select_from(Dealership)
        .outerjoin(Lead, Lead.dealership_id == Dealership.id)
        .where(Dealership.is_active == True)
        .group_by(Dealership.id, Dealership.name)
        .order_by(Dealership.name)
        .limit(limit)
    )

    performance_data = []
    for row in stats_result.all():
        total_leads = row.total_leads or 0
        converted_leads = row.converted_leads or 0
        conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0
        performance_data.append(
            DealershipPerformance(
                id=row.id,
                name=row.name,
                total_leads=total_leads,
                converted_leads=converted_leads,
                conversion_rate=round(conversion_rate, 1),
                active_leads=row.active_leads or 0,
            )
        )

    performance_data.sort(key=lambda x: x.conversion_rate, reverse=True)
    await cache_set(
        cache_key,
        [item.model_dump(mode="json") for item in performance_data],
        _DASHBOARD_TTL,
    )
    return performance_data


@router.get("/super-admin/leads-by-source", response_model=List[LeadsBySource])
async def get_leads_by_source(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_SYSTEM_REPORTS))
) -> Any:
    """Get lead distribution by source"""
    cache_key = f"dash:super-admin:leads-by-source:{current_user.id}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return [LeadsBySource(**row) for row in cached]

    total_result = await db.execute(select(func.count()).select_from(Lead))
    total_leads = total_result.scalar() or 0

    counts_result = await db.execute(
        select(Lead.source, func.count().label("count")).group_by(Lead.source)
    )
    count_by_source = {row.source: row.count for row in counts_result.all()}

    source_data = []
    for source in LeadSource:
        count = count_by_source.get(source, 0)
        percentage = (count / total_leads * 100) if total_leads > 0 else 0
        source_data.append(
            LeadsBySource(
                source=source.value,
                count=count,
                percentage=round(percentage, 1),
            )
        )

    await cache_set(
        cache_key,
        [item.model_dump(mode="json") for item in source_data],
        _DASHBOARD_TTL,
    )
    return source_data


@router.get("/dealership-admin/stats", response_model=DealershipAdminStats)
async def get_dealership_admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_DEALERSHIP_REPORTS))
) -> Any:
    """Get statistics for Dealership Admin / Manager dashboard (single-org)."""
    accessible_ids = await get_accessible_dealership_ids(db, current_user)
    cache_key = f"dash:dealership-admin:{current_user.id}:{_scope_cache_key(accessible_ids)}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return DealershipAdminStats(**cached)

    lead_scope = _lead_dealership_clause(accessible_ids)
    user_scope = _user_dealership_clause(accessible_ids)

    def _with_lead_scope(*extra):
        clauses = [c for c in (lead_scope, *extra) if c is not None]
        return and_(*clauses) if clauses else True

    # Total leads
    total_result = await db.execute(
        select(func.count()).select_from(Lead).where(_with_lead_scope())
    )
    total_leads = total_result.scalar() or 0

    # Unassigned to salesperson
    unassigned_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(Lead.assigned_to.is_(None))
        )
    )
    unassigned_leads = unassigned_result.scalar() or 0

    # Active leads
    active_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(Lead.is_active == True)
        )
    )
    active_leads = active_result.scalar() or 0

    # Converted leads
    converted_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(Lead.outcome == "converted")
        )
    )
    converted_leads = converted_result.scalar() or 0

    conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0

    # Team size
    team_clauses = [User.role == UserRole.SALESPERSON, User.is_active == True]
    if user_scope is not None:
        team_clauses.append(user_scope)
    team_result = await db.execute(
        select(func.count()).select_from(User).where(and_(*team_clauses))
    )
    team_size = team_result.scalar() or 0

    # Get team member IDs for follow-up filtering
    team_ids_clauses = [User.is_active == True]
    if user_scope is not None:
        team_ids_clauses.append(user_scope)
    team_ids_result = await db.execute(
        select(User.id).where(and_(*team_ids_clauses))
    )
    team_ids = [row[0] for row in team_ids_result.fetchall()]
    
    # Follow-ups due today
    today = utc_now().date()
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
                FollowUp.scheduled_at < utc_now()
            )
        )
    )
    overdue_follow_ups = overdue_result.scalar() or 0

    # Fresh leads: only creation activity (untouched) and unassigned
    fresh_subq = (
        select(Activity.lead_id)
        .where(Activity.lead_id.isnot(None))
        .group_by(Activity.lead_id)
        .having(func.count(Activity.id) == 1)
    )
    fresh_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(
                Lead.assigned_to.is_(None),
                Lead.id.in_(fresh_subq),
            )
        )
    )
    fresh_leads = fresh_result.scalar() or 0

    result = DealershipAdminStats(
        total_leads=total_leads,
        unassigned_to_salesperson=unassigned_leads,
        active_leads=active_leads,
        converted_leads=converted_leads,
        conversion_rate=f"{conversion_rate:.1f}%",
        team_size=team_size,
        pending_follow_ups=pending_follow_ups,
        overdue_follow_ups=overdue_follow_ups,
        fresh_leads=fresh_leads,
    )
    await cache_set(cache_key, result.model_dump(mode="json"), _DASHBOARD_TTL)
    return result


@router.get("/salesperson/stats", response_model=SalespersonStats)
async def get_salesperson_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """Get statistics for Salesperson dashboard"""
    user_id = current_user.id
    cache_key = f"dash:salesperson:{user_id}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return SalespersonStats(**cached)

    total_result = await db.execute(
        select(func.count()).select_from(Lead).where(Lead.assigned_to == user_id)
    )
    total_leads = total_result.scalar() or 0

    all_stages = await LeadStageService.list_stages(db, current_user.dealership_id)
    stage_counts_result = await db.execute(
        select(Lead.stage_id, func.count().label("count"))
        .where(Lead.assigned_to == user_id)
        .group_by(Lead.stage_id)
    )
    stage_count_map = {row.stage_id: row.count for row in stage_counts_result.all()}
    leads_by_status = {stage.name: stage_count_map.get(stage.id, 0) for stage in all_stages}

    # Active = is_active True
    active_result_sp = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(Lead.assigned_to == user_id, Lead.is_active == True)
        )
    )
    active_leads = active_result_sp.scalar() or 0

    converted_result_sp = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(Lead.assigned_to == user_id, Lead.outcome == "converted")
        )
    )
    converted_leads = converted_result_sp.scalar() or 0

    lost_result_sp = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(Lead.assigned_to == user_id, Lead.outcome == "lost")
        )
    )
    lost_leads = lost_result_sp.scalar() or 0
    
    conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0
    
    # Today's follow-ups
    today = utc_now().date()
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
                FollowUp.scheduled_at < utc_now()
            )
        )
    )
    overdue_follow_ups = overdue_result.scalar() or 0

    # Fresh leads: only creation activity (untouched) and unassigned (in salesperson's dealership)
    fresh_subq = (
        select(Activity.lead_id)
        .where(Activity.lead_id.isnot(None))
        .group_by(Activity.lead_id)
        .having(func.count(Activity.id) == 1)
    )
    fresh_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            and_(
                Lead.dealership_id == current_user.dealership_id,
                Lead.assigned_to.is_(None),
                Lead.id.in_(fresh_subq),
            )
        )
    )
    fresh_leads = fresh_result.scalar() or 0

    result = SalespersonStats(
        total_leads=total_leads,
        active_leads=active_leads,
        converted_leads=converted_leads,
        lost_leads=lost_leads,
        conversion_rate=f"{conversion_rate:.1f}%",
        todays_follow_ups=todays_follow_ups,
        overdue_follow_ups=overdue_follow_ups,
        leads_by_status=leads_by_status,
        fresh_leads=fresh_leads,
    )
    await cache_set(cache_key, result.model_dump(mode="json"), _DASHBOARD_TTL)
    return result


@router.get("/bdc/stats", response_model=BdcStats)
async def get_bdc_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.BDC)),
) -> Any:
    """Aggregated dashboard stats (single-org: all leads for BDC)."""
    accessible_ids = await get_accessible_dealership_ids(db, current_user)
    if accessible_ids is not None and len(accessible_ids) == 0:
        return BdcStats(
            total_leads=0,
            active_leads=0,
            unassigned_to_salesperson=0,
            converted_leads=0,
            conversion_rate="0.0%",
            todays_follow_ups=0,
            overdue_follow_ups=0,
            upcoming_appointments=0,
            fresh_leads=0,
            dealership_count=0,
            dealerships=[],
        )

    cache_key = f"dash:bdc:{current_user.id}:{_scope_cache_key(accessible_ids)}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return BdcStats(**cached)

    lead_scope = _lead_dealership_clause(accessible_ids)
    appt_scope = _appointment_dealership_clause(accessible_ids)

    def _with_lead_scope(*extra):
        clauses = [c for c in (lead_scope, *extra) if c is not None]
        return and_(*clauses) if clauses else True

    fresh_subq = (
        select(Activity.lead_id)
        .where(Activity.lead_id.isnot(None))
        .group_by(Activity.lead_id)
        .having(func.count(Activity.id) == 1)
    )
    total_result = await db.execute(
        select(func.count()).select_from(Lead).where(_with_lead_scope())
    )
    total_leads = total_result.scalar() or 0

    active_result = await db.execute(
        select(func.count()).select_from(Lead).where(_with_lead_scope(Lead.is_active == True))
    )
    active_leads = active_result.scalar() or 0

    unassigned_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(Lead.assigned_to.is_(None))
        )
    )
    unassigned_leads = unassigned_result.scalar() or 0

    converted_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(Lead.outcome == "converted")
        )
    )
    converted_leads = converted_result.scalar() or 0
    conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0

    lead_ids_subq = select(Lead.id)
    if lead_scope is not None:
        lead_ids_subq = lead_ids_subq.where(lead_scope)
    today = utc_now().date()
    todays_fu = await db.execute(
        select(func.count()).select_from(FollowUp).where(
            and_(
                FollowUp.lead_id.in_(lead_ids_subq),
                FollowUp.status == FollowUpStatus.PENDING,
                func.date(FollowUp.scheduled_at) == today,
            )
        )
    )
    overdue_fu = await db.execute(
        select(func.count()).select_from(FollowUp).where(
            and_(
                FollowUp.lead_id.in_(lead_ids_subq),
                FollowUp.status == FollowUpStatus.PENDING,
                FollowUp.scheduled_at < utc_now(),
            )
        )
    )
    now = utc_now()
    appt_clauses = [
        appt_scope,
        Appointment.scheduled_at > now,
        Appointment.status.in_(
            [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]
        ),
    ]
    appt_clauses = [c for c in appt_clauses if c is not None]
    upcoming_appt = await db.execute(
        select(func.count()).select_from(Appointment).where(and_(*appt_clauses))
    )

    fresh_leads_result = await db.execute(
        select(func.count()).select_from(Lead).where(
            _with_lead_scope(
                Lead.assigned_to.is_(None),
                Lead.id.in_(fresh_subq),
            )
        )
    )
    fresh_leads_total = fresh_leads_result.scalar() or 0

    if accessible_ids is None:
        dealer_rows = await db.execute(
            select(Dealership.id, Dealership.name)
            .where(Dealership.is_active == True)
            .order_by(Dealership.name)
        )
    else:
        dealer_rows = await db.execute(
            select(Dealership.id, Dealership.name)
            .where(Dealership.id.in_(accessible_ids))
            .order_by(Dealership.name)
        )
    dealers = {did: dname for did, dname in dealer_rows.fetchall()}
    dealer_ids = list(dealers.keys())

    lead_agg_map: dict = {}
    overdue_map: dict = {}
    today_fu_map: dict = {}

    if dealer_ids:
        lead_agg_clauses = [Lead.dealership_id.in_(dealer_ids)]
        if lead_scope is not None:
            lead_agg_clauses.append(lead_scope)

        lead_agg_result = await db.execute(
            select(
                Lead.dealership_id,
                func.count().label("total"),
                func.count().filter(Lead.assigned_to.is_(None)).label("unassigned"),
                func.count().filter(
                    and_(Lead.assigned_to.is_(None), Lead.id.in_(fresh_subq))
                ).label("fresh"),
            )
            .where(and_(*lead_agg_clauses))
            .group_by(Lead.dealership_id)
        )
        lead_agg_map = {row.dealership_id: row for row in lead_agg_result.all()}

        fu_clauses = [
            FollowUp.status == FollowUpStatus.PENDING,
            Lead.dealership_id.in_(dealer_ids),
        ]
        if lead_scope is not None:
            fu_clauses.append(lead_scope)

        fu_overdue_result = await db.execute(
            select(Lead.dealership_id, func.count().label("cnt"))
            .select_from(FollowUp)
            .join(Lead, FollowUp.lead_id == Lead.id)
            .where(and_(*fu_clauses, FollowUp.scheduled_at < now))
            .group_by(Lead.dealership_id)
        )
        overdue_map = {row.dealership_id: row.cnt for row in fu_overdue_result.all()}

        fu_today_result = await db.execute(
            select(Lead.dealership_id, func.count().label("cnt"))
            .select_from(FollowUp)
            .join(Lead, FollowUp.lead_id == Lead.id)
            .where(and_(*fu_clauses, func.date(FollowUp.scheduled_at) == today))
            .group_by(Lead.dealership_id)
        )
        today_fu_map = {row.dealership_id: row.cnt for row in fu_today_result.all()}

    breakdown = []
    for did, dname in sorted(dealers.items(), key=lambda item: item[1]):
        agg = lead_agg_map.get(did)
        breakdown.append(
            BdcDealershipBreakdown(
                id=did,
                name=dname,
                total_leads=agg.total if agg else 0,
                unassigned_leads=agg.unassigned if agg else 0,
                overdue_follow_ups=overdue_map.get(did, 0),
                todays_follow_ups=today_fu_map.get(did, 0),
                fresh_leads=agg.fresh if agg else 0,
            )
        )

    result = BdcStats(
        total_leads=total_leads,
        active_leads=active_leads,
        unassigned_to_salesperson=unassigned_leads,
        converted_leads=converted_leads,
        conversion_rate=f"{conversion_rate:.1f}%",
        todays_follow_ups=todays_fu.scalar() or 0,
        overdue_follow_ups=overdue_fu.scalar() or 0,
        upcoming_appointments=upcoming_appt.scalar() or 0,
        fresh_leads=fresh_leads_total,
        dealership_count=len(breakdown),
        dealerships=breakdown,
    )
    await cache_set(cache_key, result.model_dump(mode="json"), _DASHBOARD_TTL)
    return result


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
    elif current_user.role == UserRole.BDC:
        return await get_bdc_stats(db, current_user)
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        return await get_dealership_admin_stats(db, current_user)
    else:
        return await get_salesperson_stats(db, current_user)
