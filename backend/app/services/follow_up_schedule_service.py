"""
Outbound call follow-up schedule for newly assigned leads.

Rules:
- Day 0, 1, 2 (starting from assignment day): one outbound call per day at 7:00 PM local time.
- After day 2: one outbound call every Friday at 7:00 PM local time through day 30.
- When lead is closed (terminal stage or manager_review), pending follow-ups are cancelled elsewhere.
"""
import logging
from datetime import date, datetime, timedelta, timezone as tz
from typing import List, Optional, Set, Tuple
from uuid import UUID

import pytz
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.models.follow_up import FollowUp, FollowUpStatus

logger = logging.getLogger(__name__)

# Default time of day for scheduled outbound calls (local time)
DEFAULT_CALL_HOUR = 19  # 7:00 PM
DEFAULT_CALL_MINUTE = 0
# How far ahead to schedule (days) - follow-ups run through day 30 only
SCHEDULE_DAYS = 30


def _local_time_to_utc(d: date, hour: int, minute: int, tz_name: str) -> datetime:
    """
    Convert a local date/time to UTC datetime.
    
    Args:
        d: The date
        hour: Hour in local time (0-23)
        minute: Minute
        tz_name: IANA timezone name (e.g., "America/New_York")
    
    Returns:
        Timezone-aware datetime in UTC
    """
    try:
        local_tz = pytz.timezone(tz_name)
    except pytz.UnknownTimeZoneError:
        logger.warning("Unknown timezone %s, falling back to UTC", tz_name)
        local_tz = pytz.UTC
    
    naive_local = datetime(d.year, d.month, d.day, hour, minute, 0)
    local_dt = local_tz.localize(naive_local)
    return local_dt.astimezone(pytz.UTC)


def _get_outbound_call_schedule(
    assignment_date: date,
    user_timezone: str = "UTC"
) -> List[Tuple[datetime, str]]:
    """
    Build list of (scheduled_at, notes) for outbound call follow-ups.
    - Day 0, 1, 2 (including assignment day) at 7:00 PM local time.
    - Every Friday at 7:00 PM local time within the 30-day window.
    Deduplicates so each date appears once (priority: Day N > Friday).
    """
    end_date = assignment_date + timedelta(days=SCHEDULE_DAYS)
    seen: Set[date] = set()
    result: List[Tuple[datetime, str]] = []

    # Days 0, 1, 2 (starting from assignment day)
    for day_offset in (0, 1, 2):
        d = assignment_date + timedelta(days=day_offset)
        if d <= end_date and d not in seen:
            seen.add(d)
            scheduled_utc = _local_time_to_utc(d, DEFAULT_CALL_HOUR, DEFAULT_CALL_MINUTE, user_timezone)
            result.append((scheduled_utc, f"Outbound call – Day {day_offset + 1}"))

    # Every Friday from day 3 onwards through end
    current = assignment_date + timedelta(days=3)
    # Move to next Friday (weekday 4)
    while current.weekday() != 4:
        current += timedelta(days=1)
    while current <= end_date:
        if current not in seen:
            seen.add(current)
            scheduled_utc = _local_time_to_utc(current, DEFAULT_CALL_HOUR, DEFAULT_CALL_MINUTE, user_timezone)
            result.append((scheduled_utc, "Outbound call – Friday"))
        current += timedelta(days=7)

    result.sort(key=lambda x: x[0])
    return result


async def schedule_outbound_call_follow_ups(
    db: AsyncSession,
    lead_id: UUID,
    assigned_to_id: UUID,
    assignment_date: Optional[date] = None,
    user_timezone: str = "UTC",
) -> int:
    """
    Create follow-ups for the outbound-call schedule (day 0-2, every Friday).
    Call this when a lead is first assigned to a salesperson.
    
    Args:
        db: Database session
        lead_id: UUID of the lead
        assigned_to_id: UUID of the assigned salesperson
        assignment_date: Date of assignment (defaults to today)
        user_timezone: IANA timezone name for scheduling times (e.g., "America/New_York")
    
    Returns:
        Number of follow-ups created.
    """
    if assignment_date is None:
        assignment_date = utc_now().date()
    schedule = _get_outbound_call_schedule(assignment_date, user_timezone)
    created = 0
    for scheduled_at, notes in schedule:
        follow_up = FollowUp(
            lead_id=lead_id,
            assigned_to=assigned_to_id,
            scheduled_at=scheduled_at,
            notes=notes,
            status=FollowUpStatus.PENDING,
        )
        db.add(follow_up)
        created += 1
    if created:
        await db.flush()
        logger.info(
            "Scheduled %s outbound call follow-ups for lead %s (assigned_to=%s, tz=%s)",
            created, lead_id, assigned_to_id, user_timezone,
        )
    return created


async def cancel_pending_follow_ups_for_lead(db: AsyncSession, lead_id: UUID) -> int:
    """
    Cancel all pending follow-ups for a lead (e.g. when lead is closed).
    Returns the number of follow-ups cancelled.
    """
    from sqlalchemy import update
    result = await db.execute(
        update(FollowUp)
        .where(FollowUp.lead_id == lead_id, FollowUp.status == FollowUpStatus.PENDING)
        .values(
            status=FollowUpStatus.CANCELLED,
            completion_notes="Lead closed",
        )
    )
    count = result.rowcount
    if count:
        await db.flush()
        logger.info("Cancelled %s pending follow-ups for closed lead %s", count, lead_id)
    return count
