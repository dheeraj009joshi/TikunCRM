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
from app.models.activity import Activity, ActivityType
from app.models.call_log import CallDirection, CallLog, CallStatus
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.schemas.time_tracking import (
    AgentRosterItem,
    AgentRosterResponse,
    CallWorkStats,
    ClockStatusResponse,
    DailyPayoutRow,
    HourCaps,
    HoursBreakdown,
    PayoutSummaryResponse,
    ShiftActivityItem,
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
UNLIMITED = Decimal("1000000")
WEEKDAY_KEYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
WEEKDAY_USER_ATTRS = {key: f"max_hours_{key}" for key in WEEKDAY_KEYS}

PERIODS = ("today", "this_week", "last_week", "this_month", "last_month", "this_year")
SHIFT_ACTIVITY_SKIP = frozenset({
    ActivityType.USER_LOGIN,
    ActivityType.USER_LOGOUT,
    ActivityType.IMPORT_COMPLETED,
    ActivityType.SYNC_COMPLETED,
})
MAX_SHIFT_ACTIVITIES = 500


def q2(value: Decimal) -> Decimal:
    return value.quantize(Q2, rounding=ROUND_HALF_UP)


def empty_breakdown() -> HoursBreakdown:
    return HoursBreakdown(
        regular_hours=ZERO,
        overtime_hours=ZERO,
        unpaid_hours=ZERO,
        payable_hours=ZERO,
        total_hours=ZERO,
        regular_pay=ZERO,
        overtime_pay=ZERO,
        estimated_pay=ZERO,
    )


def caps_from_user(user: User) -> HourCaps:
    return HourCaps(
        max_hours_week=user.max_hours_week,
        monday=user.max_hours_monday,
        tuesday=user.max_hours_tuesday,
        wednesday=user.max_hours_wednesday,
        thursday=user.max_hours_thursday,
        friday=user.max_hours_friday,
        saturday=user.max_hours_saturday,
        sunday=user.max_hours_sunday,
    )


def daily_cap(caps: Optional[HourCaps], day: date) -> Optional[Decimal]:
    if caps is None:
        return None
    return getattr(caps, WEEKDAY_KEYS[day.weekday()])


def _cap_left(cap: Optional[Decimal], used: Decimal) -> Decimal:
    if cap is None:
        return UNLIMITED
    return max(ZERO, cap - used)


def empty_call_work() -> CallWorkStats:
    return CallWorkStats()


def utilization_pct(talk_hours: Decimal, clocked_hours: Decimal) -> Optional[Decimal]:
    if clocked_hours <= 0:
        return None
    return q2((talk_hours / clocked_hours) * Decimal("100"))


def _call_work_from_rows(
    rows: list[tuple[datetime, int, CallDirection, CallStatus, Optional[datetime]]],
    period_start: datetime,
    period_end: datetime,
    now: datetime,
    clocked_hours: Decimal,
    tz: Optional[pytz.BaseTzInfo] = None,
) -> tuple[CallWorkStats, dict[date, CallWorkStats]]:
    """Build period totals and optional per-local-day stats from call rows."""
    period_start = as_utc(period_start)
    period_end = as_utc(period_end)
    now = as_utc(now)

    by_day: dict[date, dict[str, int]] = defaultdict(
        lambda: {"seconds": 0, "count": 0, "inbound": 0, "outbound": 0}
    )
    total_seconds = 0
    count = 0
    inbound = 0
    outbound = 0

    for started_at, duration, direction, status, answered_at in rows:
        started = as_utc(started_at)
        if started < period_start or started >= period_end:
            continue
        if status == CallStatus.IN_PROGRESS:
            anchor = as_utc(answered_at) if answered_at else started
            secs = max(duration_seconds(anchor, now), 0)
        else:
            secs = max(int(duration or 0), 0)
        if secs <= 0:
            continue
        total_seconds += secs
        count += 1
        if direction == CallDirection.INBOUND:
            inbound += 1
        else:
            outbound += 1
        if tz is not None:
            day = started.astimezone(tz).date()
            bucket = by_day[day]
            bucket["seconds"] += secs
            bucket["count"] += 1
            if direction == CallDirection.INBOUND:
                bucket["inbound"] += 1
            else:
                bucket["outbound"] += 1

    def to_stats(seconds: int, n: int, inn: int, out: int, clocked: Decimal) -> CallWorkStats:
        hours = q2(Decimal(seconds) / SECONDS_PER_HOUR)
        avg = int(round(seconds / n)) if n else 0
        return CallWorkStats(
            talk_seconds=seconds,
            talk_hours=hours,
            call_count=n,
            inbound_count=inn,
            outbound_count=out,
            avg_call_seconds=avg,
            utilization_pct=utilization_pct(hours, clocked),
        )

    totals = to_stats(total_seconds, count, inbound, outbound, clocked_hours)
    daily: dict[date, CallWorkStats] = {}
    if tz is not None:
        for d, b in by_day.items():
            daily[d] = to_stats(b["seconds"], b["count"], b["inbound"], b["outbound"], ZERO)
    return totals, daily


async def fetch_call_rows(
    db: AsyncSession,
    user_id: UUID,
    window_start: datetime,
    window_end: datetime,
) -> list[tuple[datetime, int, CallDirection, CallStatus, Optional[datetime]]]:
    result = await db.execute(
        select(
            CallLog.started_at,
            CallLog.duration_seconds,
            CallLog.direction,
            CallLog.status,
            CallLog.answered_at,
        ).where(
            or_(CallLog.user_id == user_id, CallLog.answered_by == user_id),
            CallLog.started_at >= as_utc(window_start),
            CallLog.started_at < as_utc(window_end),
            or_(
                and_(CallLog.status == CallStatus.COMPLETED, CallLog.duration_seconds > 0),
                CallLog.status == CallStatus.IN_PROGRESS,
            ),
        )
    )
    return list(result.all())


async def compute_call_work(
    db: AsyncSession,
    user_id: UUID,
    period_start: datetime,
    period_end: datetime,
    now: datetime,
    clocked_hours: Decimal,
    tz: Optional[pytz.BaseTzInfo] = None,
) -> tuple[CallWorkStats, dict[date, CallWorkStats]]:
    rows = await fetch_call_rows(db, user_id, period_start, period_end)
    return _call_work_from_rows(rows, period_start, period_end, now, clocked_hours, tz)


async def get_active_call_seconds(db: AsyncSession, user_id: UUID, now: datetime) -> tuple[bool, int]:
    result = await db.execute(
        select(CallLog.answered_at, CallLog.started_at)
        .where(
            or_(CallLog.user_id == user_id, CallLog.answered_by == user_id),
            CallLog.status == CallStatus.IN_PROGRESS,
        )
        .order_by(CallLog.started_at.desc())
        .limit(1)
    )
    row = result.first()
    if not row:
        return False, 0
    answered_at, started_at = row
    anchor = as_utc(answered_at) if answered_at else as_utc(started_at)
    return True, duration_seconds(anchor, now)


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
        over_cap_approved=bool(getattr(entry, "over_cap_approved", False)),
        over_cap_approved_at=getattr(entry, "over_cap_approved_at", None),
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


def _split_day_chunks(
    start: datetime,
    end: datetime,
    tz: pytz.BaseTzInfo,
) -> list[tuple[datetime, datetime, date]]:
    """Split [start, end) into local-calendar-day chunks."""
    start = as_utc(start)
    end = as_utc(end)
    if end <= start:
        return []
    chunks: list[tuple[datetime, datetime, date]] = []
    cursor = start
    for _ in range(32):
        if cursor >= end:
            break
        local = cursor.astimezone(tz)
        next_midnight = local_midnight(local.date() + timedelta(days=1), tz)
        chunk_end = min(end, next_midnight)
        chunks.append((cursor, chunk_end, local.date()))
        cursor = chunk_end
    return chunks


class _Acc:
    __slots__ = ("regular", "overtime", "unpaid", "regular_pay", "overtime_pay")

    def __init__(self) -> None:
        self.regular = ZERO
        self.overtime = ZERO
        self.unpaid = ZERO
        self.regular_pay = ZERO
        self.overtime_pay = ZERO

    def add(
        self,
        regular: Decimal,
        overtime: Decimal,
        rate: Decimal,
        multiplier: Decimal,
        unpaid: Decimal = ZERO,
    ) -> None:
        self.regular += regular
        self.overtime += overtime
        self.unpaid += unpaid
        self.regular_pay += regular * rate
        self.overtime_pay += overtime * rate * multiplier

    def to_breakdown(self) -> HoursBreakdown:
        payable = q2(self.regular + self.overtime)
        unpaid = q2(self.unpaid)
        return HoursBreakdown(
            regular_hours=q2(self.regular),
            overtime_hours=q2(self.overtime),
            unpaid_hours=unpaid,
            payable_hours=payable,
            total_hours=q2(payable + unpaid),
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
    caps: Optional[HourCaps] = None,
    fallback_rate: Optional[Decimal] = None,
) -> tuple[HoursBreakdown, dict[date, _Acc]]:
    """
    Classify hours as regular vs overtime using a running weekly total.

    Daily/weekly caps split clocked time into payable vs unpaid. Unpaid hours
    are still tracked as attendance but excluded from estimated pay unless the
    punch is marked over_cap_approved. Hours before period_start still consume
    the week's 40h OT bucket and hour caps so month/week boundaries stay correct.

    Punches snapshot the rate at clock-in. If that snapshot is missing, pay
    uses ``fallback_rate`` (the agent's current hourly rate) so hours are not
    silently valued at $0.
    """
    period_start = as_utc(period_start)
    period_end = as_utc(period_end)
    now = as_utc(now)

    by_week: dict[datetime, list[tuple[datetime, datetime, Decimal, Decimal, bool]]] = defaultdict(list)
    for entry in entries:
        end = entry.clock_out_at or now
        if entry.hourly_rate is not None:
            rate = entry.hourly_rate
        elif fallback_rate is not None:
            rate = fallback_rate
        else:
            rate = ZERO
        multiplier = entry.overtime_multiplier or OT_MULTIPLIER
        approved = bool(getattr(entry, "over_cap_approved", False))
        for seg_start, seg_end, ws in _split_week_segments(entry.clock_in_at, end, tz):
            by_week[ws].append((seg_start, seg_end, rate, multiplier, approved))

    totals = _Acc()
    by_day: dict[date, _Acc] = defaultdict(_Acc)

    for ws in sorted(by_week.keys()):
        remaining_ot = OT_THRESHOLD_HOURS
        week_used = ZERO
        day_used: dict[date, Decimal] = defaultdict(lambda: ZERO)
        segs = sorted(by_week[ws], key=lambda s: s[0])
        for seg_start, seg_end, rate, multiplier, approved in segs:
            for chunk_start, chunk_end, day in _split_day_chunks(seg_start, seg_end, tz):
                hours = hours_between(chunk_start, chunk_end)
                if hours <= 0:
                    continue
                day_left = _cap_left(daily_cap(caps, day), day_used[day])
                week_left = _cap_left(caps.max_hours_week if caps else None, week_used)
                if approved:
                    payable, unpaid = hours, ZERO
                else:
                    payable = min(hours, day_left, week_left)
                    unpaid = hours - payable
                day_used[day] += hours
                week_used += hours

                if payable <= remaining_ot:
                    reg, ot = payable, ZERO
                    remaining_ot -= payable
                else:
                    reg, ot = remaining_ot, payable - remaining_ot
                    remaining_ot = ZERO

                overlap_start = max(chunk_start, period_start)
                overlap_end = min(chunk_end, period_end)
                if overlap_end <= overlap_start:
                    continue
                overlap_hours = hours_between(overlap_start, overlap_end)
                if overlap_hours <= 0:
                    continue

                if overlap_hours < hours and hours > 0:
                    ratio = overlap_hours / hours
                    overlap_reg = q2(reg * ratio)
                    overlap_ot = q2(ot * ratio)
                    overlap_unpaid = q2(unpaid * ratio)
                else:
                    overlap_reg, overlap_ot, overlap_unpaid = reg, ot, unpaid

                totals.add(overlap_reg, overlap_ot, rate, multiplier, overlap_unpaid)
                if daily:
                    by_day[day].add(overlap_reg, overlap_ot, rate, multiplier, overlap_unpaid)

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
    caps: Optional[HourCaps] = None,
    fallback_rate: Optional[Decimal] = None,
) -> HoursBreakdown:
    week_origin = week_start_utc(period_start, tz)
    entries = await fetch_entries_overlapping(db, user_id, week_origin, period_end)
    breakdown, _ = classify_entries(
        entries,
        period_start,
        period_end,
        tz,
        now,
        caps=caps,
        fallback_rate=fallback_rate,
    )
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
    caps = caps_from_user(user)

    today_start, today_end = period_bounds("today", now, tz)
    week_start, week_end = period_bounds("this_week", now, tz)
    month_start, month_end = period_bounds("this_month", now, tz)

    today = await compute_breakdown(
        db, user.id, today_start, today_end, tz, now, caps, user.hourly_rate
    )
    this_week = await compute_breakdown(
        db, user.id, week_start, week_end, tz, now, caps, user.hourly_rate
    )
    this_month = await compute_breakdown(
        db, user.id, month_start, month_end, tz, now, caps, user.hourly_rate
    )
    today_calls, _ = await compute_call_work(
        db, user.id, today_start, today_end, now, today.total_hours, tz
    )
    this_week_calls, _ = await compute_call_work(
        db, user.id, week_start, week_end, now, this_week.total_hours, tz
    )
    this_month_calls, _ = await compute_call_work(
        db, user.id, month_start, month_end, now, this_month.total_hours, tz
    )
    on_call, current_call_seconds = await get_active_call_seconds(db, user.id, now)

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
        today_calls=today_calls,
        this_week_calls=this_week_calls,
        this_month_calls=this_month_calls,
        on_call=on_call,
        current_call_seconds=current_call_seconds,
        hour_caps=caps,
        over_cap_warning=today.unpaid_hours > 0 or this_week.unpaid_hours > 0,
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


def _lead_display_name(first_name: Optional[str], last_name: Optional[str]) -> Optional[str]:
    name = f"{first_name or ''} {last_name or ''}".strip()
    return name or None


async def fetch_shift_activities(
    db: AsyncSession,
    user_id: UUID,
    entries: list[TimeEntry],
    period_start: datetime,
    period_end: datetime,
    now: datetime,
) -> list[ShiftActivityItem]:
    """CRM work that happened while the agent was clocked in during the period."""
    period_start = as_utc(period_start)
    period_end = as_utc(period_end)
    now = as_utc(now)
    windows: list[tuple[datetime, datetime, UUID]] = []
    for entry in entries:
        start = max(as_utc(entry.clock_in_at), period_start)
        end = min(as_utc(entry.clock_out_at or now), period_end)
        if end > start:
            windows.append((start, end, entry.id))
    if not windows:
        return []

    window_filters = [and_(Activity.created_at >= start, Activity.created_at < end) for start, end, _ in windows]
    result = await db.execute(
        select(Activity, Customer.first_name, Customer.last_name)
        .outerjoin(Lead, Activity.lead_id == Lead.id)
        .outerjoin(Customer, Lead.customer_id == Customer.id)
        .where(
            Activity.user_id == user_id,
            Activity.type.notin_(SHIFT_ACTIVITY_SKIP),
            or_(*window_filters),
        )
        .order_by(Activity.created_at.desc())
        .limit(MAX_SHIFT_ACTIVITIES)
    )

    items: list[ShiftActivityItem] = []
    for activity, first_name, last_name in result.all():
        created = as_utc(activity.created_at)
        entry_id = None
        for start, end, eid in windows:
            if start <= created < end:
                entry_id = eid
                break
        items.append(
            ShiftActivityItem(
                id=activity.id,
                type=activity.type.value if hasattr(activity.type, "value") else str(activity.type),
                description=activity.description,
                created_at=activity.created_at,
                lead_id=activity.lead_id,
                lead_name=_lead_display_name(first_name, last_name),
                time_entry_id=entry_id,
                meta_data=activity.meta_data or {},
            )
        )
    return items


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
    caps = caps_from_user(user)
    totals, by_day = classify_entries(
        entries, period_start, period_end, tz, now, daily=True, caps=caps, fallback_rate=user.hourly_rate
    )
    call_work, call_by_day = await compute_call_work(
        db, user.id, period_start, period_end, now, totals.total_hours, tz
    )

    weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    all_dates = set(by_day.keys()) | set(call_by_day.keys())
    days: list[DailyPayoutRow] = []
    for d in sorted(all_dates):
        bd = by_day[d].to_breakdown() if d in by_day else empty_breakdown()
        day_calls = call_by_day.get(d, empty_call_work())
        if bd.total_hours > 0:
            day_calls = day_calls.model_copy(
                update={"utilization_pct": utilization_pct(day_calls.talk_hours, bd.total_hours)}
            )
        days.append(
            DailyPayoutRow(
                date=d.isoformat(),
                weekday=weekday_names[d.weekday()],
                regular_hours=bd.regular_hours,
                overtime_hours=bd.overtime_hours,
                unpaid_hours=bd.unpaid_hours,
                payable_hours=bd.payable_hours,
                total_hours=bd.total_hours,
                estimated_pay=bd.estimated_pay,
                daily_cap=daily_cap(caps, d),
                over_cap_approved=any(
                    bool(getattr(e, "over_cap_approved", False))
                    and (
                        as_utc(e.clock_in_at).astimezone(tz).date() == d
                        or (
                            e.clock_out_at
                            and as_utc(e.clock_out_at).astimezone(tz).date() == d
                        )
                        or (e.clock_out_at is None and now.astimezone(tz).date() == d)
                    )
                    for e in entries
                ),
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
                call_work=day_calls,
            )
        )

    period_entries = [
        e
        for e in entries
        if as_utc(e.clock_in_at) < period_end
        and (e.clock_out_at is None or as_utc(e.clock_out_at) > period_start)
    ]
    period_entries.sort(key=lambda e: e.clock_in_at, reverse=True)

    activities = await fetch_shift_activities(db, user.id, period_entries, period_start, period_end, now)

    return PayoutSummaryResponse(
        period=period,
        timezone=str(tz),
        period_start=period_start,
        period_end=period_end,
        hourly_rate=user.hourly_rate,
        overtime_multiplier=OT_MULTIPLIER,
        overtime_threshold_hours=OT_THRESHOLD_HOURS,
        totals=totals,
        hour_caps=caps,
        call_work=call_work,
        days=days,
        entries=[to_entry_response(e, now) for e in period_entries],
        activities=activities,
    )


async def set_hourly_rate(db: AsyncSession, user: User, rate: Decimal) -> User:
    user.hourly_rate = q2(rate)
    await db.commit()
    await db.refresh(user)
    return user


async def set_hour_caps(db: AsyncSession, user: User, caps: HourCaps) -> User:
    user.max_hours_week = q2(caps.max_hours_week) if caps.max_hours_week is not None else None
    for key, attr in WEEKDAY_USER_ATTRS.items():
        val = getattr(caps, key)
        setattr(user, attr, q2(val) if val is not None else None)
    await db.commit()
    await db.refresh(user)
    return user


async def set_over_cap_approved(
    db: AsyncSession,
    entry: TimeEntry,
    editor: User,
    approved: bool,
) -> TimeEntry:
    now = utc_now()
    entry.over_cap_approved = approved
    if approved:
        entry.over_cap_approved_by_id = editor.id
        entry.over_cap_approved_at = now
    else:
        entry.over_cap_approved_by_id = None
        entry.over_cap_approved_at = None
    await db.commit()
    await db.refresh(entry)
    return entry


async def set_over_cap_approved_for_day(
    db: AsyncSession,
    user_id: UUID,
    local_date: date,
    tz: pytz.BaseTzInfo,
    editor: User,
    approved: bool,
) -> list[TimeEntry]:
    start = local_midnight(local_date, tz)
    end = local_midnight(local_date + timedelta(days=1), tz)
    entries = await fetch_entries_overlapping(db, user_id, start, end)
    now = utc_now()
    for entry in entries:
        entry.over_cap_approved = approved
        if approved:
            entry.over_cap_approved_by_id = editor.id
            entry.over_cap_approved_at = now
        else:
            entry.over_cap_approved_by_id = None
            entry.over_cap_approved_at = None
    await db.commit()
    return entries


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
    on_call_count = 0

    for agent in agents:
        open_entry = await get_open_entry(db, agent.id)
        elapsed = duration_seconds(open_entry.clock_in_at, now) if open_entry else 0
        caps = caps_from_user(agent)
        today = await compute_breakdown(
            db, agent.id, today_start, today_end, tz, now, caps, agent.hourly_rate
        )
        this_week = await compute_breakdown(
            db, agent.id, week_start, week_end, tz, now, caps, agent.hourly_rate
        )
        this_month = await compute_breakdown(
            db, agent.id, month_start, month_end, tz, now, caps, agent.hourly_rate
        )
        today_calls, _ = await compute_call_work(
            db, agent.id, today_start, today_end, now, today.total_hours, tz
        )
        this_week_calls, _ = await compute_call_work(
            db, agent.id, week_start, week_end, now, this_week.total_hours, tz
        )
        on_call, _ = await get_active_call_seconds(db, agent.id, now)

        items.append(
            AgentRosterItem(
                id=agent.id,
                first_name=agent.first_name,
                last_name=agent.last_name,
                email=agent.email,
                is_active=agent.is_active,
                hourly_rate=agent.hourly_rate,
                hour_caps=caps,
                is_clocked_in=open_entry is not None,
                clock_in_at=open_entry.clock_in_at if open_entry else None,
                elapsed_seconds=elapsed,
                on_call=on_call,
                this_week=this_week,
                this_month=this_month,
                today=today,
                today_calls=today_calls,
                this_week_calls=this_week_calls,
            )
        )
        if open_entry:
            clocked_in += 1
        if on_call:
            on_call_count += 1

    def sum_breakdowns(rows: list[HoursBreakdown]) -> HoursBreakdown:
        acc = _Acc()
        for b in rows:
            acc.regular += b.regular_hours
            acc.overtime += b.overtime_hours
            acc.unpaid += b.unpaid_hours
            acc.regular_pay += b.regular_pay
            acc.overtime_pay += b.overtime_pay
        return acc.to_breakdown()

    def sum_call_work(rows: list[CallWorkStats], clocked: Decimal) -> CallWorkStats:
        seconds = sum(r.talk_seconds for r in rows)
        n = sum(r.call_count for r in rows)
        inn = sum(r.inbound_count for r in rows)
        out = sum(r.outbound_count for r in rows)
        hours = q2(Decimal(seconds) / SECONDS_PER_HOUR)
        avg = int(round(seconds / n)) if n else 0
        return CallWorkStats(
            talk_seconds=seconds,
            talk_hours=hours,
            call_count=n,
            inbound_count=inn,
            outbound_count=out,
            avg_call_seconds=avg,
            utilization_pct=utilization_pct(hours, clocked),
        )

    team_week = sum_breakdowns([i.this_week for i in items])
    return AgentRosterResponse(
        items=items,
        clocked_in_count=clocked_in,
        on_call_count=on_call_count,
        team_week=team_week,
        team_month=sum_breakdowns([i.this_month for i in items]),
        team_week_calls=sum_call_work([i.this_week_calls for i in items], team_week.total_hours),
    )
