"""
Resync Google Sheet leads and compare counts: sheet vs system.

Usage (from backend directory):
    python -m scripts.resync_google_sheet_and_compare

Runs the sync, then prints:
  - Rows in sheet (total and valid)
  - Leads in system (source=google_sheets)
  - New added, duplicates skipped, invalid skipped
So you can verify no leads are missing (e.g. sheet private = 0 from sheet; fix by making sheet public).
"""

import asyncio
from sqlalchemy import select, func
from app.core.config import settings
from app.services.google_sheets_sync import sync_google_sheet_leads, get_sync_session_maker
from app.models.lead import Lead, LeadSource


async def main():
    print("Running Google Sheet sync...")
    result = await sync_google_sheet_leads()

    # Count leads in system (google_sheets source)
    sync_session_maker = get_sync_session_maker()
    async with sync_session_maker() as session:
        r = await session.execute(
            select(func.count(Lead.id)).where(Lead.source == LeadSource.GOOGLE_SHEETS)
        )
        leads_in_system = r.scalar() or 0

    print("\n--- Sheet vs system ---")
    print(f"  Sheet total rows:     {result.get('sheet_total_rows', 0)}")
    print(f"  Sheet valid leads:    {result.get('sheet_valid_leads', 0)}  (rows with full_name + phone)")
    print(f"  Leads in system:      {leads_in_system}  (source=google_sheets)")
    print(f"  New added this run:   {result.get('new_added', 0)}")
    print(f"  Duplicates skipped:   {result.get('duplicates_skipped', 0)}")
    print(f"  Invalid rows skipped: {result.get('skipped_invalid', 0)}")
    if result.get("error"):
        print(f"  Error:                {result['error']}")

    if result.get("sheet_valid_leads", 0) == 0 and result.get("sheet_total_rows", 0) == 0:
        print("\n  Tip: If the sheet has data but counts are 0, the sheet may be private.")
        print("  Share the sheet so 'Anyone with the link' can view, or use a public CSV URL.")
    elif result.get("sheet_valid_leads") and leads_in_system < result["sheet_valid_leads"]:
        print("\n  Note: System count is less than sheet valid leads (some may be duplicates by phone/external_id).")


if __name__ == "__main__":
    asyncio.run(main())
