"""
Outbound call follow-up schedule for newly assigned leads.

Rules:
- First 3 days: one outbound call per day (day 1, 2, 3 after assign).
- After day 3: one outbound call every 3 days (day 6, 9, 12, ...) through day 30.
- Every Friday within the 30-day window.
- When lead is closed (terminal stage), pending follow-ups are cancelled elsewhere.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Set, Tuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.models.follow_up import FollowUp, FollowUpStatus

logger = logging.getLogger(__name__)

# Default time of day for scheduled outbound calls (UTC)
DEFAULT_CALL_HOUR = 10
DEFAULT_CALL_MINUTE = 0
# How far ahead to schedule (days) - follow-ups run through day 30 only
SCHEDULE_DAYS = 30


def _date_at_time(d: date, hour: int = DEFAULT_CALL_HOUR, minute: int = DEFAULT_CALL_MINUTE) -> datetime:
    """Return timezone-aware datetime for date at given time (UTC)."""
    return datetime(d.year, d.month, d.day, hour, minute, 0, tzinfo=timezone.utc)


def _get_outbound_call_schedule(assignment_date: date) -> List[Tuple[datetime, str]]:
    """
    Build list of (scheduled_at, notes) for outbound call follow-ups.
    - Day 1, 2, 3 after assign.
    - Then every 3 days (6, 9, 12, ...) through day 30.
    - Every Friday within the 30-day window.
    Deduplicates so each date appears once (notes reflect priority: Day N > Friday > Every 3 days).
    """
    end_date = assignment_date + timedelta(days=SCHEDULE_DAYS)
    seen: Set[date] = set()
    result: List[Tuple[datetime, str]] = []

    # Days 1, 2, 3
    for day_offset in (1, 2, 3):
        d = assignment_date + timedelta(days=day_offset)
        if d <= end_date and d not in seen:
            seen.add(d)
            result.append((_date_at_time(d), f"Outbound call – Day {day_offset}"))

    # Every 3 days: 6, 9, 12, ...
    day_offset = 6
    while True:
        d = assignment_date + timedelta(days=day_offset)
        if d > end_date:
            break
        if d not in seen:
            seen.add(d)
            result.append((_date_at_time(d), f"Outbound call – Day {day_offset}"))
        day_offset += 3

    # Every Friday from assignment week through end
    current = assignment_date
    # Move to next Friday (weekday 4)
    while current.weekday() != 4:
        current += timedelta(days=1)
    while current <= end_date:
        if current not in seen:
            seen.add(current)
            result.append((_date_at_time(current), "Outbound call – Friday"))
        current += timedelta(days=7)

    result.sort(key=lambda x: x[0])
    return result


async def schedule_outbound_call_follow_ups(
    db: AsyncSession,
    lead_id: UUID,
    assigned_to_id: UUID,
    assignment_date: Optional[date] = None,
) -> int:
    """
    Create follow-ups for the outbound-call schedule (day 1–3, every 3 days, every Friday).
    Call this when a lead is first assigned to a salesperson.
    Returns the number of follow-ups created.
    """
    if assignment_date is None:
        assignment_date = utc_now().date()
    schedule = _get_outbound_call_schedule(assignment_date)
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
            "Scheduled %s outbound call follow-ups for lead %s (assigned_to=%s)",
            created, lead_id, assigned_to_id,
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
