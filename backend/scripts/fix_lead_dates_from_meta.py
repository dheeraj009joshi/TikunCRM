"""
One-time script to fix lead created_at dates from meta_data['created_time'].

Many leads synced from Google Sheets originally had their created_at set to the sync time
instead of the actual lead creation time from the sheet. This script updates those leads
to use the correct date from their meta_data.

Usage (from backend directory):
    python -m scripts.fix_lead_dates_from_meta

Add --dry-run to preview changes without committing:
    python -m scripts.fix_lead_dates_from_meta --dry-run
"""

import asyncio
import sys
from datetime import datetime, timezone
from dateutil import parser as dateutil_parser
from sqlalchemy import select, update
from app.db.database import async_session_maker
from app.models.lead import Lead, LeadSource


def parse_created_time(created_time_str: str) -> datetime | None:
    """Parse created_time string to timezone-aware datetime."""
    if not (created_time_str or "").strip():
        return None
    try:
        dt = dateutil_parser.parse(created_time_str.strip())
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def main():
    dry_run = "--dry-run" in sys.argv
    
    if dry_run:
        print("=== DRY RUN MODE - No changes will be made ===\n")
    
    async with async_session_maker() as session:
        # Find all Google Sheets leads with created_time in meta_data
        result = await session.execute(
            select(Lead).where(
                Lead.source == LeadSource.GOOGLE_SHEETS,
                Lead.meta_data.isnot(None),
            )
        )
        leads = result.scalars().all()
        
        print(f"Found {len(leads)} Google Sheets leads to check\n")
        
        updated_count = 0
        skipped_no_created_time = 0
        skipped_same_date = 0
        errors = 0
        
        for lead in leads:
            meta_data = lead.meta_data or {}
            created_time_str = meta_data.get("created_time")
            
            if not created_time_str:
                skipped_no_created_time += 1
                continue
            
            parsed_date = parse_created_time(created_time_str)
            if not parsed_date:
                errors += 1
                print(f"  ERROR: Could not parse '{created_time_str}' for lead {lead.id}")
                continue
            
            # Check if dates are already the same (within 1 day tolerance)
            current_created = lead.created_at
            if current_created:
                # Make both timezone-aware for comparison
                if current_created.tzinfo is None:
                    current_created = current_created.replace(tzinfo=timezone.utc)
                
                diff = abs((parsed_date - current_created).total_seconds())
                if diff < 86400:  # Less than 1 day difference
                    skipped_same_date += 1
                    continue
            
            # Update the lead
            if not dry_run:
                lead.created_at = parsed_date
            
            updated_count += 1
            print(f"  {'[DRY RUN] Would update' if dry_run else 'Updated'} lead {lead.id}: "
                  f"{current_created.strftime('%Y-%m-%d %H:%M') if current_created else 'None'} -> "
                  f"{parsed_date.strftime('%Y-%m-%d %H:%M')}")
        
        if not dry_run and updated_count > 0:
            await session.commit()
            print(f"\nCommitted {updated_count} updates to database.")
        
        print(f"\n=== Summary ===")
        print(f"Total leads checked: {len(leads)}")
        print(f"Updated: {updated_count}")
        print(f"Skipped (no created_time): {skipped_no_created_time}")
        print(f"Skipped (already correct): {skipped_same_date}")
        print(f"Errors: {errors}")
        
        if dry_run and updated_count > 0:
            print(f"\nRun without --dry-run to apply these changes.")


if __name__ == "__main__":
    asyncio.run(main())
