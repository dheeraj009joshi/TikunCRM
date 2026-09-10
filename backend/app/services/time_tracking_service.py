"""
Time tracking service for BDC agents.

Clock-in / clock-out is independent of CRM login. Hours are classified against
a Monday–Sunday work week (FLSA-style): the first 40 hours in a week are
regular, the rest are overtime at 1.5x. Each punch snapshots the agent's
hourly rate so historical payouts stay accurate after rate changes.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, time, date
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional
from uuid import UUID

import pytz
from sqlalchemy import select, func, and_, or_, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezone import utc_now
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.schemas.time_tracking import (
    AgentRosterItem,
    AgentRosterResponse,
    ClockStatusResponse,
    DailyPayoutRow,
    HoursBreakdown,
    PayoutSummaryResponse,
    TimeEntryListResponse,
    TimeEntryResponse,
    TimeEntryUserBrief,
)
from app.utils.timezone import DEFAULT_DEALERSHIP_TIMEZONE

OT_THRESHOLD_HOURS = Decimal("40")
OT_MULTIPLIER = Decimal("1.50")
LONG_SHIFT_HOURS = Decimal("12")
SECONDS_PER_HOUR = Decimal("3600")
ZERO = Decimal("0.00")
Q2 = Decimal("0.01")

PERIODS = ("today", "this_week", "last_week", "this_month", "last_month", "this_year")


def q2(value: Decimal) -> Decimal:
    return value.quantize(Q2, rounding=ROUND_HALF_UP)


def empty_breakdown() -> HoursBreakdown:
    return HoursBreakdown(
        regular_hours=ZERO,
        overtime_hours=ZERO,
        total_hours=ZERO,
        regular_pay=ZERO,
        overtime_pay=ZERO,
        estimated_pay=ZERO,
    )


def resolve_tz(name: Optional[str]) -> pytz.BaseTzInfo:
    raw = (name or "").strip() or DEFAULT_DEALERSHIP_TIMEZONE
    try:
        return pytz.timezone(raw)
    except pytz.UnknownTimeZoneError:
        return pytz.timezone(DEFAULT_DEALERSHIP_TIMEZONE)


def as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return pytz.UTC.localize(dt)
    return dt.astimezone(pytz.UTC)


def local_midnight(d: date, tz: pytz.BaseTzInfo) -> datetime:
    return tz.localize(datetime.combine(d, time.min)).astimezone(pytz.UTC)


def week_start_utc(dt: datetime, tz: pytz.BaseTzInfo) -> datetime:
    local = as_utc(dt).astimezone(tz)
    monday = local.date() - timedelta(days=local.weekday())
    return local_midnight(monday, tz)


def period_bounds(
    period: str,
    now: datetime,
    tz: pytz.BaseTzInfo,
) -> tuple[datetime, datetime]:
    now = as_utc(now)
    local = now.astimezone(tz)
    today = local.date()

    if period == "today":
        start = local_midnight(today, tz)
        return start, now
    if period == "this_week":
        return week_start_utc(now, tz), now
    if period == "last_week":
        this_week = week_start_utc(now, tz)
        return this_week - timedelta(days=7), this_week
    if period == "this_month":
        start = local_midnight(today.replace(day=1), tz)
        return start, now
    if period == "last_month":
        this_month = local_midnight(today.replace(day=1), tz)
        last_day_prev = this_month.astimezone(tz).date() - timedelta(days=1)
        start = local_midnight(last_day_prev.replace(day=1), tz)
        return start, this_month
    if period == "this_year":
        start = local_midnight(date(today.year, 1, 1), tz)
        return start, now
    raise ValueError(f"Unknown period: {period}")


def duration_seconds(start: datetime, end: datetime) -> int:
    secs = int((as_utc(end) - as_utc(start)).total_seconds())
    return max(secs, 0)


def hours_between(start: datetime, end: datetime) -> Decimal:
    return q2(Decimal(duration_seconds(start, end)) / SECONDS_PER_HOUR)


def to_entry_response(
    entry: TimeEntry,
    now: Optional[datetime] = None,
    include_user: bool = False,
) -> TimeEntryResponse:
    now = now or utc_now()
    end = entry.clock_out_at or now
    user_brief = None
    if include_user and entry.user is not None:
        user_brief = TimeEntryUserBrief.model_validate(entry.user)
    return TimeEntryResponse(
        id=entry.id,
        user_id=entry.user_id,
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        hourly_rate=entry.hourly_rate,
        overtime_multiplier=entry.overtime_multiplier or OT_MULTIPLIER,
        clock_in_note=entry.clock_in_note,
        notes=entry.notes,
        source=entry.source,
        is_open=entry.clock_out_at is None,
        duration_seconds=duration_seconds(entry.clock_in_at, end),
        edited_at=entry.edited_at,
        edit_reason=entry.edit_reason,
        user=user_brief,
    )


def _split_week_segments(
    start: datetime,
    end: datetime,
    tz: pytz.BaseTzInfo,
) -> list[tuple[datetime, datetime, datetime]]:
    """Split [start, end) into segments that each live in one work week.

    Returns (seg_start, seg_end, week_start_utc).
    """
    start = as_utc(start)
    end = as_utc(end)
    if end <= start:
        return []
    segments: list[tuple[datetime, datetime, datetime]] = []
    cursor = start
    # Guard against pathological loops
    for _ in range(16):
        if cursor >= end:
            break
        ws = week_start_utc(cursor, tz)
        we = ws + timedelta(days=7)
        seg_end = min(end, we)
        segments.append((cursor, seg_end, ws))
        cursor = seg_end
    return segments


class _Acc:
    __slots__ = ("regular", "overtime", "regular_pay", "overtime_pay")

    def __init__(self) -> None:
        self.regular = ZERO
        self.overtime = ZERO
        self.regular_pay = ZERO
        self.overtime_pay = ZERO

    def add(self, regular: Decimal, overtime: Decimal, rate: Decimal, multiplier: Decimal) -> None:
        self.regular += regular
        self.overtime += overtime
        self.regular_pay += regular * rate
        self.overtime_pay += overtime * rate * multiplier

    def to_breakdown(self) -> HoursBreakdown:
        return HoursBreakdown(
            regular_hours=q2(self.regular),
            overtime_hours=q2(self.overtime),
            total_hours=q2(self.regular + self.overtime),
            regular_pay=q2(self.regular_pay),
            overtime_pay=q2(self.overtime_pay),
            estimated_pay=q2(self.regular_pay + self.overtime_pay),
        )


def classify_entries(
    entries: Iterable[TimeEntry],
    period_start: datetime,
    period_end: datetime,
    tz: pytz.BaseTzInfo,
    now: datetime,
    daily: bool = False,
) -> tuple[HoursBreakdown, dict[date, _Acc]]:
    """
    Classify hours as regular vs overtime using a running weekly total.

    Hours before period_start still consume the week's 40h bucket so OT at
    the start of a month/week is correct. Only hours inside the period are
    added to the returned totals.
    """
    period_start = as_utc(period_start)
    period_end = as_utc(period_end)
    now = as_utc(now)

    by_week: dict[datetime, list[tuple[datetime, datetime, Decimal, Decimal]]] = defaultdict(list)
    for entry in entries:
        end = entry.clock_out_at or now
        rate = entry.hourly_rate if entry.hourly_rate is not None else ZERO
        multiplier = entry.overtime_multiplier or OT_MULTIPLIER
        for seg_start, seg_end, ws in _split_week_segments(entry.clock_in_at, end, tz):
            by_week[ws].append((seg_start, seg_end, rate, multiplier))

    totals = _Acc()
    by_day: dict[date, _Acc] = defaultdict(_Acc)

    for ws in sorted(by_week.keys()):
        remaining = OT_THRESHOLD_HOURS
        segs = sorted(by_week[ws], key=lambda s: s[0])
        for seg_start, seg_end, rate, multiplier in segs:
            hours = hours_between(seg_start, seg_end)
            if hours <= 0:
                continue
            if hours <= remaining:
                reg, ot = hours, ZERO
                remaining -= hours
            else:
                reg, ot = remaining, hours - remaining
                remaining = ZERO

            overlap_start = max(seg_start, period_start)
            overlap_end = min(seg_end, period_end)
            if overlap_end <= overlap_start:
                continue
            overlap_hours = hours_between(overlap_start, overlap_end)
            if overlap_hours <= 0:
                continue

            # Attribute overlap proportionally if the segment was clipped
            if overlap_hours < hours and hours > 0:
                ratio = overlap_hours / hours
                overlap_reg = q2(reg * ratio)
                overlap_ot = q2(ot * ratio)
            else:
                overlap_reg, overlap_ot = reg, ot

            totals.add(overlap_reg, overlap_ot, rate, multiplier)

            if daily:
                # Split overlap across local calendar days
                cursor = overlap_start
                leftover_reg, leftover_ot = overlap_reg, overlap_ot
                while cursor < overlap_end and (leftover_reg + leftover_ot) > 0:
                    local = cursor.astimezone(tz)
                    next_midnight = local_midnight(local.date() + timedelta(days=1), tz)
                    chunk_end = min(overlap_end, next_midnight)
                    chunk_hours = hours_between(cursor, chunk_end)
                    if chunk_hours <= 0:
                        break
                    take_reg = min(leftover_reg, chunk_hours)
                    take_ot = min(leftover_ot, chunk_hours - take_reg)
                    leftover_reg -= take_reg
                    leftover_ot -= take_ot
                    by_day[local.date()].add(take_reg, take_ot, rate, multiplier)
                    cursor = chunk_end

    return totals.to_breakdown(), by_day


async def get_open_entry(db: AsyncSession, user_id: UUID) -> Optional[TimeEntry]:
    result = await db.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user_id,
            TimeEntry.clock_out_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def fetch_entries_overlapping(
    db: AsyncSession,
    user_id: UUID,
    window_start: datetime,
    window_end: datetime,
) -> list[TimeEntry]:
    result = await db.execute(
        select(TimeEntry)
        .where(
            TimeEntry.user_id == user_id,
            TimeEntry.clock_in_at < window_end,
            or_(TimeEntry.clock_out_at.is_(None), TimeEntry.clock_out_at > window_start),
        )
        .order_by(TimeEntry.clock_in_at.asc())
    )
    return list(result.scalars().all())


async def compute_breakdown(
    db: AsyncSession,
    user_id: UUID,
    period_start: datetime,
    period_end: datetime,
    tz: pytz.BaseTzInfo,
    now: datetime,
) -> HoursBreakdown:
    week_origin = week_start_utc(period_start, tz)
    entries = await fetch_entries_overlapping(db, user_id, week_origin, period_end)
    breakdown, _ = classify_entries(entries, period_start, period_end, tz, now)
    return breakdown


async def clock_in(db: AsyncSession, user: User, note: Optional[str] = None) -> TimeEntry:
    existing = await get_open_entry(db, user.id)
    if existing:
        raise ValueError("already_clocked_in")

    entry = TimeEntry(
        user_id=user.id,
        clock_in_at=utc_now(),
        hourly_rate=user.hourly_rate,
        overtime_multiplier=OT_MULTIPLIER,
        clock_in_note=(note or "").strip() or None,
        source="web",
    )
    db.add(entry)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ValueError("already_clocked_in") from exc
    await db.refresh(entry)
    return entry


async def clock_out(db: AsyncSession, user: User, note: Optional[str] = None) -> TimeEntry:
    entry = await get_open_entry(db, user.id)
    if not entry:
        raise ValueError("not_clocked_in")
    now = utc_now()
    if as_utc(entry.clock_in_at) > now:
        raise ValueError("invalid_times")
    entry.clock_out_at = now
    extra = (note or "").strip()
    if extra:
        entry.notes = f"{entry.notes}\n{extra}".strip() if entry.notes else extra
    await db.commit()
    await db.refresh(entry)
    return entry


async def get_status(
    db: AsyncSession,
    user: User,
    timezone_name: Optional[str],
) -> ClockStatusResponse:
    tz = resolve_tz(timezone_name)
    now = utc_now()
    open_entry = await get_open_entry(db, user.id)

    today_start, today_end = period_bounds("today", now, tz)
    week_start, week_end = period_bounds("this_week", now, tz)
    month_start, month_end = period_bounds("this_month", now, tz)

    today = await compute_breakdown(db, user.id, today_start, today_end, tz, now)
    this_week = await compute_breakdown(db, user.id, week_start, week_end, tz, now)
    this_month = await compute_breakdown(db, user.id, month_start, month_end, tz, now)

    elapsed = 0
    long_shift = False
    current = None
    if open_entry:
        elapsed = duration_seconds(open_entry.clock_in_at, now)
        long_shift = Decimal(elapsed) / SECONDS_PER_HOUR >= LONG_SHIFT_HOURS
        current = to_entry_response(open_entry, now)

    return ClockStatusResponse(
        is_clocked_in=open_entry is not None,
        current_entry=current,
        elapsed_seconds=elapsed,
        hourly_rate=user.hourly_rate,
        overtime_multiplier=OT_MULTIPLIER,
        overtime_threshold_hours=OT_THRESHOLD_HOURS,
        rate_missing=user.hourly_rate is None,
        long_shift_warning=long_shift,
        today=today,
        this_week=this_week,
        this_month=this_month,
    )


async def list_entries(
    db: AsyncSession,
    user_id: UUID,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    page: int,
    page_size: int,
    include_user: bool = False,
) -> TimeEntryListResponse:
    now = utc_now()
    filters = [TimeEntry.user_id == user_id]
    if date_from:
        filters.append(
            or_(TimeEntry.clock_out_at.is_(None), TimeEntry.clock_out_at >= as_utc(date_from))
        )
        filters.append(TimeEntry.clock_in_at < (as_utc(date_to) if date_to else now + timedelta(days=1)))
    if date_to and not date_from:
        filters.append(TimeEntry.clock_in_at < as_utc(date_to))

    count_q = select(func.count()).select_from(TimeEntry).where(and_(*filters))
    total = (await db.execute(count_q)).scalar_one()

    q = (
        select(TimeEntry)
        .where(and_(*filters))
        .order_by(TimeEntry.clock_in_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if include_user:
        q = q.options(selectinload(TimeEntry.user))
    rows = list((await db.execute(q)).scalars().all())
    return TimeEntryListResponse(
        items=[to_entry_response(e, now, include_user=include_user) for e in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


async def list_all_entries(
    db: AsyncSession,
    user_id: Optional[UUID],
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    page: int,
    page_size: int,
) -> TimeEntryListResponse:
    now = utc_now()
    filters = []
    if user_id:
        filters.append(TimeEntry.user_id == user_id)
    if date_from:
        filters.append(
            or_(TimeEntry.clock_out_at.is_(None), TimeEntry.clock_out_at >= as_utc(date_from))
        )
    if date_to:
        filters.append(TimeEntry.clock_in_at < as_utc(date_to))

    where = and_(*filters) if filters else true()
    total = (await db.execute(select(func.count()).select_from(TimeEntry).where(where))).scalar_one()
    q = (
        select(TimeEntry)
        .options(selectinload(TimeEntry.user))
        .where(where)
        .order_by(TimeEntry.clock_in_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list((await db.execute(q)).scalars().all())
    return TimeEntryListResponse(
        items=[to_entry_response(e, now, include_user=True) for e in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_payouts(
    db: AsyncSession,
    user: User,
    period: str,
    timezone_name: Optional[str],
) -> PayoutSummaryResponse:
    if period not in PERIODS:
        raise ValueError("invalid_period")
    tz = resolve_tz(timezone_name)
    now = utc_now()
    period_start, period_end = period_bounds(period, now, tz)
    week_origin = week_start_utc(period_start, tz)
    entries = await fetch_entries_overlapping(db, user.id, week_origin, period_end)
    totals, by_day = classify_entries(
        entries, period_start, period_end, tz, now, daily=True
    )

    weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    days: list[DailyPayoutRow] = []
    for d in sorted(by_day.keys()):
        bd = by_day[d].to_breakdown()
        days.append(
            DailyPayoutRow(
                date=d.isoformat(),
                weekday=weekday_names[d.weekday()],
                regular_hours=bd.regular_hours,
                overtime_hours=bd.overtime_hours,
                total_hours=bd.total_hours,
                estimated_pay=bd.estimated_pay,
                entry_count=sum(
                    1
                    for e in entries
                    if as_utc(e.clock_in_at).astimezone(tz).date() == d
                    or (
                        e.clock_out_at
                        and as_utc(e.clock_out_at).astimezone(tz).date() == d
                    )
                    or (e.clock_out_at is None and now.astimezone(tz).date() == d)
                ),
            )
        )

    period_entries = [
        e
        for e in entries
        if as_utc(e.clock_in_at) < period_end
        and (e.clock_out_at is None or as_utc(e.clock_out_at) > period_start)
    ]
    period_entries.sort(key=lambda e: e.clock_in_at, reverse=True)

    return PayoutSummaryResponse(
        period=period,
        timezone=str(tz),
        period_start=period_start,
        period_end=period_end,
        hourly_rate=user.hourly_rate,
        overtime_multiplier=OT_MULTIPLIER,
        overtime_threshold_hours=OT_THRESHOLD_HOURS,
        totals=totals,
        days=days,
        entries=[to_entry_response(e, now) for e in period_entries],
    )


async def set_hourly_rate(db: AsyncSession, user: User, rate: Decimal) -> User:
    user.hourly_rate = q2(rate)
    await db.commit()
    await db.refresh(user)
    return user


async def edit_entry(
    db: AsyncSession,
    entry: TimeEntry,
    editor: User,
    clock_in_at: Optional[datetime],
    clock_out_at: Optional[datetime],
    notes: Optional[str],
    reason: str,
) -> TimeEntry:
    now = utc_now()
    new_in = as_utc(clock_in_at) if clock_in_at else as_utc(entry.clock_in_at)
    if clock_out_at is not None:
        new_out: Optional[datetime] = as_utc(clock_out_at)
    else:
        new_out = entry.clock_out_at
        if new_out is not None:
            new_out = as_utc(new_out)

    if new_out is not None and new_out <= new_in:
        raise ValueError("clock_out_before_clock_in")
    if new_in > now:
        raise ValueError("clock_in_in_future")

    entry.clock_in_at = new_in
    if clock_out_at is not None:
        entry.clock_out_at = new_out
    if notes is not None:
        entry.notes = notes.strip() or None
    entry.edited_by_id = editor.id
    entry.edited_at = now
    entry.edit_reason = reason.strip()
    await db.commit()
    await db.refresh(entry)
    return entry


async def force_clock_out(
    db: AsyncSession,
    entry: TimeEntry,
    editor: User,
    reason: str,
    clock_out_at: Optional[datetime] = None,
) -> TimeEntry:
    if entry.clock_out_at is not None:
        raise ValueError("already_clocked_out")
    now = utc_now()
    out = as_utc(clock_out_at) if clock_out_at else now
    if out <= as_utc(entry.clock_in_at):
        raise ValueError("clock_out_before_clock_in")
    entry.clock_out_at = out
    entry.edited_by_id = editor.id
    entry.edited_at = now
    entry.edit_reason = reason.strip() or "Force clock-out by admin"
    await db.commit()
    await db.refresh(entry)
    return entry


async def get_roster(
    db: AsyncSession,
    timezone_name: Optional[str],
) -> AgentRosterResponse:
    from app.core.permissions import UserRole

    tz = resolve_tz(timezone_name)
    now = utc_now()
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.BDC)
        .order_by(User.first_name.asc(), User.last_name.asc())
    )
    agents = list(result.scalars().all())

    today_start, today_end = period_bounds("today", now, tz)
    week_start, week_end = period_bounds("this_week", now, tz)
    month_start, month_end = period_bounds("this_month", now, tz)

    items: list[AgentRosterItem] = []
    clocked_in = 0

    for agent in agents:
        open_entry = await get_open_entry(db, agent.id)
        elapsed = duration_seconds(open_entry.clock_in_at, now) if open_entry else 0
        today = await compute_breakdown(db, agent.id, today_start, today_end, tz, now)
        this_week = await compute_breakdown(db, agent.id, week_start, week_end, tz, now)
        this_month = await compute_breakdown(db, agent.id, month_start, month_end, tz, now)

        items.append(
            AgentRosterItem(
                id=agent.id,
                first_name=agent.first_name,
                last_name=agent.last_name,
                email=agent.email,
                is_active=agent.is_active,
                hourly_rate=agent.hourly_rate,
                is_clocked_in=open_entry is not None,
                clock_in_at=open_entry.clock_in_at if open_entry else None,
                elapsed_seconds=elapsed,
                this_week=this_week,
                this_month=this_month,
                today=today,
            )
        )
        if open_entry:
            clocked_in += 1

    def sum_breakdowns(rows: list[HoursBreakdown]) -> HoursBreakdown:
        acc = _Acc()
        for b in rows:
            acc.regular += b.regular_hours
            acc.overtime += b.overtime_hours
            acc.regular_pay += b.regular_pay
            acc.overtime_pay += b.overtime_pay
        return acc.to_breakdown()

    return AgentRosterResponse(
        items=items,
        clocked_in_count=clocked_in,
        team_week=sum_breakdowns([i.this_week for i in items]),
        team_month=sum_breakdowns([i.this_month for i in items]),
    )
