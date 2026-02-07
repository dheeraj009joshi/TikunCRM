"""
Find sheet rows that matched existing leads with source != GOOGLE_SHEETS.
Those are the "missing" from the 164 - 158 = 6 (they're in the system under another source).

Usage (from backend directory):
    python -m scripts.find_sheet_leads_not_google_source
"""

import asyncio
from sqlalchemy import select
from app.services.google_sheets_sync import fetch_sheet_data, parse_sheet_row, get_sync_session_maker
from app.models.lead import Lead, LeadSource


async def main():
    rows, headers = await fetch_sheet_data()
    if not rows:
        print("Could not fetch sheet (e.g. private).")
        return

    # Collect all (external_id, phone) from sheet
    sheet_external_ids = set()
    sheet_phones = set()
    sheet_names = {}  # phone -> name for display
    for row in rows:
        lead_data = parse_sheet_row(row, headers)
        if lead_data:
            eid = lead_data.get("external_id")
            phone = lead_data.get("phone")
            if eid:
                sheet_external_ids.add(eid)
            if phone:
                sheet_phones.add(phone)
                sheet_names[phone] = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip()

    sync_session_maker = get_sync_session_maker()
    async with sync_session_maker() as session:
        from sqlalchemy import or_
        conditions = []
        if sheet_external_ids:
            conditions.append(Lead.external_id.in_(sheet_external_ids))
        if sheet_phones:
            conditions.append(Lead.phone.in_(sheet_phones))
        if not conditions:
            leads = []
        else:
            result = await session.execute(
                select(Lead).where(
                    Lead.source != LeadSource.GOOGLE_SHEETS,
                    or_(*conditions),
                )
            )
            leads = result.scalars().all()

    print(f"Leads that appear in the sheet but are stored with source != GOOGLE_SHEETS: {len(leads)}\n")
    for lead in leads:
        name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "(no name)"
        print(f"  ID: {lead.id}  |  {name}  |  {lead.phone or '-'}  |  source={getattr(lead.source, 'value', lead.source)}")


if __name__ == "__main__":
    asyncio.run(main())
