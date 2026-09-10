"""
Time tracking endpoints — BDC clock-in/out, timesheets, and manager pay settings.
"""
from datetime import date, datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.schemas.time_tracking import (
    AgentRosterItem,
    AgentRosterResponse,
    ApproveOverCapDayRequest,
    ApproveOverCapRequest,
    ClockInRequest,
    ClockOutRequest,
    ClockStatusResponse,
    PayoutSummaryResponse,
    SetHourCapsRequest,
    SetHourlyRateRequest,
    TimeEntryEditRequest,
    TimeEntryListResponse,
    TimeEntryResponse,
)
from app.services import time_tracking_service as svc

router = APIRouter()

require_time_admin = deps.require_admin


def _http_for_value_error(exc: ValueError) -> HTTPException:
    mapping = {
        "already_clocked_in": (409, "You are already clocked in. Clock out first."),
        "not_clocked_in": (409, "You are not clocked in."),
        "invalid_period": (400, "Invalid period. Use today, this_week, last_week, this_month, last_month, or this_year."),
        "clock_out_before_clock_in": (400, "Clock-out must be after clock-in."),
        "clock_in_in_future": (400, "Clock-in cannot be in the future."),
        "already_clocked_out": (409, "This session is already clocked out."),
        "invalid_times": (400, "Invalid clock times."),
        "invalid_date": (400, "Invalid date. Use YYYY-MM-DD."),
    }
    code, detail = mapping.get(str(exc), (400, str(exc)))
    return HTTPException(status_code=code, detail=detail)


async def _load_bdc_user(db: AsyncSession, user_id: UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.role != UserRole.BDC:
        raise HTTPException(status_code=404, detail="BDC agent not found")
    return user


@router.get("/status", response_model=ClockStatusResponse)
async def get_clock_status(
    timezone: Optional[str] = Query(None, description="IANA timezone for day/week boundaries"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.BDC)),
) -> Any:
    """Current clock status, live elapsed time, and today/week/month totals."""
    return await svc.get_status(db, current_user, timezone)


@router.post("/clock-in", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
async def clock_in(
    body: ClockInRequest = Body(default=ClockInRequest()),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.BDC)),
) -> Any:
    """Start a work session. Independent of CRM login."""
    try:
        entry = await svc.clock_in(db, current_user, body.note)
    except ValueError as exc:
        raise _http_for_value_error(exc) from exc
    return svc.to_entry_response(entry)


@router.post("/clock-out", response_model=TimeEntryResponse)
async def clock_out(
    body: ClockOutRequest = Body(default=ClockOutRequest()),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.BDC)),
) -> Any:
    """End the current work session."""
    try:
        entry = await svc.clock_out(db, current_user, body.note)
    except ValueError as exc:
        raise _http_for_value_error(exc) from exc
    return svc.to_entry_response(entry)


@router.get("/entries", response_model=TimeEntryListResponse)
async def list_my_entries(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.BDC)),
) -> Any:
    """Paginated punch history for the current BDC agent."""
    return await svc.list_entries(db, current_user.id, date_from, date_to, page, page_size)


@router.get("/payouts", response_model=PayoutSummaryResponse)
async def get_my_payouts(
    period: str = Query("this_week"),
    timezone: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.BDC)),
) -> Any:
    """Hours and estimated pay for a period (week / month / year)."""
    try:
        return await svc.get_payouts(db, current_user, period, timezone)
    except ValueError as exc:
        raise _http_for_value_error(exc) from exc


# ---------- Super Admin / Manager ----------


@router.get("/admin/roster", response_model=AgentRosterResponse)
async def admin_roster(
    timezone: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    """Who is on the clock, weekly/monthly hours, and labor cost for all BDC agents."""
    return await svc.get_roster(db, timezone)


@router.patch("/admin/agents/{user_id}/rate", response_model=AgentRosterItem)
async def admin_set_rate(
    user_id: UUID,
    body: SetHourlyRateRequest,
    timezone: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    """Set a BDC agent's hourly rate. Applies to future punches only."""
    user = await _load_bdc_user(db, user_id)
    await svc.set_hourly_rate(db, user, body.hourly_rate)
    roster = await svc.get_roster(db, timezone)
    for item in roster.items:
        if item.id == user.id:
            return item
    raise HTTPException(status_code=404, detail="BDC agent not found")


@router.patch("/admin/agents/{user_id}/caps", response_model=AgentRosterItem)
async def admin_set_caps(
    user_id: UUID,
    body: SetHourCapsRequest,
    timezone: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    """Set payable hour caps per weekday and per week. Extra clocked time is unpaid until approved."""
    user = await _load_bdc_user(db, user_id)
    await svc.set_hour_caps(db, user, body)
    roster = await svc.get_roster(db, timezone)
    for item in roster.items:
        if item.id == user.id:
            return item
    raise HTTPException(status_code=404, detail="BDC agent not found")


@router.get("/admin/entries", response_model=TimeEntryListResponse)
async def admin_list_entries(
    user_id: Optional[UUID] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    return await svc.list_all_entries(db, user_id, date_from, date_to, page, page_size)


@router.get("/admin/payouts/{user_id}", response_model=PayoutSummaryResponse)
async def admin_agent_payouts(
    user_id: UUID,
    period: str = Query("this_week"),
    timezone: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    user = await _load_bdc_user(db, user_id)
    try:
        return await svc.get_payouts(db, user, period, timezone)
    except ValueError as exc:
        raise _http_for_value_error(exc) from exc


@router.patch("/admin/entries/{entry_id}", response_model=TimeEntryResponse)
async def admin_edit_entry(
    entry_id: UUID,
    body: TimeEntryEditRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    result = await db.execute(
        select(TimeEntry).options(selectinload(TimeEntry.user)).where(TimeEntry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")
    try:
        updated = await svc.edit_entry(
            db,
            entry,
            current_user,
            body.clock_in_at,
            body.clock_out_at,
            body.notes,
            body.reason,
        )
    except ValueError as exc:
        raise _http_for_value_error(exc) from exc
    return svc.to_entry_response(updated, include_user=False)


@router.patch("/admin/entries/{entry_id}/over-cap", response_model=TimeEntryResponse)
async def admin_set_over_cap(
    entry_id: UUID,
    body: ApproveOverCapRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    result = await db.execute(select(TimeEntry).where(TimeEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")
    updated = await svc.set_over_cap_approved(db, entry, current_user, body.approved)
    return svc.to_entry_response(updated)


@router.post("/admin/agents/{user_id}/approve-day")
async def admin_approve_day(
    user_id: UUID,
    body: ApproveOverCapDayRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    await _load_bdc_user(db, user_id)
    try:
        local_date = date.fromisoformat(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD.") from exc
    tz = svc.resolve_tz(body.timezone)
    entries = await svc.set_over_cap_approved_for_day(
        db, user_id, local_date, tz, current_user, body.approved
    )
    return {
        "updated": len(entries),
        "date": body.date,
        "approved": body.approved,
    }


@router.post("/admin/entries/{entry_id}/force-clock-out", response_model=TimeEntryResponse)
async def admin_force_clock_out(
    entry_id: UUID,
    body: ClockOutRequest = Body(default=ClockOutRequest()),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_time_admin),
) -> Any:
    result = await db.execute(select(TimeEntry).where(TimeEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")
    try:
        updated = await svc.force_clock_out(
            db,
            entry,
            current_user,
            body.note or "Force clock-out by admin",
        )
    except ValueError as exc:
        raise _http_for_value_error(exc) from exc
    return svc.to_entry_response(updated)
