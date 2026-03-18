"""
One-time script to migrate existing follow-ups to the new scheduling rules.

This script will:
1. Cancel all pending follow-ups for leads in "sold", "not_qualified", "lost", or "manager_review" stages
2. Delete all remaining pending follow-ups for active leads
3. Create new follow-ups based on the new rules:
   - Day 0, 1, 2 at 7:00 PM (user's local timezone)
   - Every Friday at 7:00 PM for 30 days

Usage (from backend directory):
    python -m scripts.migrate_follow_ups_to_new_rules

Add --dry-run to preview changes without committing:
    python -m scripts.migrate_follow_ups_to_new_rules --dry-run
"""

import asyncio
import sys
from datetime import datetime, timedelta, date
from typing import List, Tuple

import pytz
from sqlalchemy import select, update, delete
from sqlalchemy.orm import selectinload

from app.db.database import async_session_maker
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.models.lead_stage import LeadStage
from app.models.user import User
from app.models.dealership import Dealership
from app.core.timezone import utc_now


# Stages that should have all follow-ups cancelled
CANCEL_STAGES = {"sold", "not_qualified", "lost", "manager_review", "converted"}

# Follow-up scheduling constants
DEFAULT_CALL_HOUR = 19  # 7:00 PM
DEFAULT_CALL_MINUTE = 0
FOLLOW_UP_WINDOW_DAYS = 30


def _local_time_to_utc(d: date, hour: int, minute: int, tz_name: str) -> datetime:
    """Convert a local date+time to UTC datetime."""
    try:
        local_tz = pytz.timezone(tz_name)
    except pytz.UnknownTimeZoneError:
        local_tz = pytz.UTC
    
    naive_local = datetime(d.year, d.month, d.day, hour, minute, 0)
    local_dt = local_tz.localize(naive_local)
    return local_dt.astimezone(pytz.UTC).replace(tzinfo=None)


def _get_outbound_call_schedule(
    assignment_date: date,
    user_timezone: str = "UTC"
) -> List[Tuple[datetime, str]]:
    """
    Generate follow-up schedule based on new rules:
    - Day 0, 1, 2 at 7:00 PM local time
    - Every Friday at 7:00 PM local time for 30 days
    """
    result: List[Tuple[datetime, str]] = []
    end_date = assignment_date + timedelta(days=FOLLOW_UP_WINDOW_DAYS)
    seen: set[date] = set()

    # Days 0, 1, 2 (starting from assignment day)
    for day_offset in (0, 1, 2):
        d = assignment_date + timedelta(days=day_offset)
        if d <= end_date and d not in seen:
            seen.add(d)
            scheduled_utc = _local_time_to_utc(d, DEFAULT_CALL_HOUR, DEFAULT_CALL_MINUTE, user_timezone)
            result.append((scheduled_utc, f"Outbound call – Day {day_offset + 1}"))

    # Every Friday from day 3 onwards through end
    current = assignment_date + timedelta(days=3)
    while current.weekday() != 4:  # Find next Friday
        current += timedelta(days=1)
    while current <= end_date:
        if current not in seen:
            seen.add(current)
            scheduled_utc = _local_time_to_utc(current, DEFAULT_CALL_HOUR, DEFAULT_CALL_MINUTE, user_timezone)
            result.append((scheduled_utc, "Outbound call – Friday"))
        current += timedelta(days=7)

    result.sort(key=lambda x: x[0])
    return result


async def main():
    dry_run = "--dry-run" in sys.argv
    
    if dry_run:
        print("=== DRY RUN MODE - No changes will be made ===\n")
    
    async with async_session_maker() as session:
        now = utc_now()
        
        # Get all lead stages
        stages_result = await session.execute(select(LeadStage))
        stages = {s.name.lower(): s for s in stages_result.scalars().all()}
        
        # Get stage IDs to cancel
        cancel_stage_ids = set()
        for stage_name in CANCEL_STAGES:
            if stage_name in stages:
                cancel_stage_ids.add(stages[stage_name].id)
                # Also add terminal stages
                if stages[stage_name].is_terminal:
                    cancel_stage_ids.add(stages[stage_name].id)
        
        # Add all terminal stages
        for stage in stages.values():
            if stage.is_terminal:
                cancel_stage_ids.add(stage.id)
        
        print(f"Stages that will have follow-ups cancelled: {[s.name for s in stages.values() if s.id in cancel_stage_ids]}")
        
        # Step 1: Get all pending follow-ups
        pending_result = await session.execute(
            select(FollowUp)
            .options(selectinload(FollowUp.lead))
            .where(FollowUp.status == FollowUpStatus.PENDING)
        )
        pending_follow_ups = pending_result.scalars().all()
        
        print(f"\nFound {len(pending_follow_ups)} pending follow-ups")
        
        # Categorize follow-ups
        to_cancel = []  # For leads in cancel stages
        to_delete = []  # For active leads (will be recreated)
        
        for fu in pending_follow_ups:
            if fu.lead and fu.lead.stage_id in cancel_stage_ids:
                to_cancel.append(fu)
            else:
                to_delete.append(fu)
        
        print(f"  - {len(to_cancel)} follow-ups to CANCEL (leads in terminal/closed stages)")
        print(f"  - {len(to_delete)} follow-ups to DELETE and RECREATE (active leads)")
        
        # Step 2: Cancel follow-ups for closed leads
        if to_cancel:
            print(f"\n--- Cancelling {len(to_cancel)} follow-ups for closed leads ---")
            for fu in to_cancel:
                lead_name = f"{fu.lead.first_name} {fu.lead.last_name or ''}".strip() if fu.lead else "Unknown"
                stage_name = stages.get(fu.lead.stage_id, "Unknown") if fu.lead else "Unknown"
                print(f"  CANCEL: Follow-up {fu.id} for lead '{lead_name}' (stage: {fu.lead.stage.name if fu.lead and fu.lead.stage else 'Unknown'})")
                if not dry_run:
                    fu.status = FollowUpStatus.CANCELLED
        
        # Step 3: Delete follow-ups for active leads
        if to_delete:
            print(f"\n--- Deleting {len(to_delete)} follow-ups for active leads ---")
            for fu in to_delete:
                lead_name = f"{fu.lead.first_name} {fu.lead.last_name or ''}".strip() if fu.lead else "Unknown"
                print(f"  DELETE: Follow-up {fu.id} for lead '{lead_name}' scheduled at {fu.scheduled_at}")
            
            if not dry_run:
                delete_ids = [fu.id for fu in to_delete]
                await session.execute(
                    delete(FollowUp).where(FollowUp.id.in_(delete_ids))
                )
        
        # Step 4: Get all active leads with assignments to create new follow-ups
        # Get leads that are assigned and not in cancel stages
        active_leads_result = await session.execute(
            select(Lead)
            .options(selectinload(Lead.stage))
            .where(
                Lead.assigned_to.isnot(None),
                Lead.is_active == True,
                Lead.stage_id.notin_(cancel_stage_ids) if cancel_stage_ids else True
            )
        )
        active_leads = active_leads_result.scalars().all()
        
        print(f"\n--- Creating new follow-ups for {len(active_leads)} active assigned leads ---")
        
        # Get dealerships for timezone lookup
        dealership_result = await session.execute(select(Dealership))
        dealerships = {d.id: d for d in dealership_result.scalars().all()}
        
        # Get users for dealership lookup
        user_result = await session.execute(select(User))
        users = {u.id: u for u in user_result.scalars().all()}
        
        new_follow_ups_created = 0
        
        for lead in active_leads:
            # Get timezone from dealership
            user_timezone = "UTC"
            assigned_user = users.get(lead.assigned_to)
            if assigned_user and assigned_user.dealership_id:
                dealership = dealerships.get(assigned_user.dealership_id)
                if dealership and dealership.timezone:
                    user_timezone = dealership.timezone
            
            # Use today as the "assignment date" for generating schedule
            # This will create follow-ups starting from today
            today = now.date()
            schedule = _get_outbound_call_schedule(today, user_timezone)
            
            # Filter to only future follow-ups
            future_schedule = [(dt, note) for dt, note in schedule if dt > now.replace(tzinfo=None)]
            
            lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
            
            if not future_schedule:
                print(f"  SKIP: Lead '{lead_name}' - no future follow-ups in schedule")
                continue
            
            print(f"  CREATE: {len(future_schedule)} follow-ups for lead '{lead_name}' (TZ: {user_timezone})")
            
            for scheduled_at, notes in future_schedule:
                if not dry_run:
                    follow_up = FollowUp(
                        lead_id=lead.id,
                        assigned_to=lead.assigned_to,
                        scheduled_at=scheduled_at,
                        notes=notes,
                        status=FollowUpStatus.PENDING,
                    )
                    session.add(follow_up)
                new_follow_ups_created += 1
        
        # Commit changes
        if not dry_run:
            await session.commit()
            print(f"\n=== Changes committed to database ===")
        
        # Summary
        print(f"\n=== Summary ===")
        print(f"Follow-ups cancelled (closed leads): {len(to_cancel)}")
        print(f"Follow-ups deleted (active leads): {len(to_delete)}")
        print(f"New follow-ups created: {new_follow_ups_created}")
        
        if dry_run:
            print(f"\nRun without --dry-run to apply these changes.")


if __name__ == "__main__":
    asyncio.run(main())
