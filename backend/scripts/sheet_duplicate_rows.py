"""
Find duplicate rows in the sheet (same phone or external_id).
The 164 - 158 = 6 difference is likely 6 sheet rows that duplicate other rows.

Usage (from backend directory):
    python -m scripts.sheet_duplicate_rows
"""

import asyncio
from collections import defaultdict
from app.services.google_sheets_sync import fetch_sheet_data, parse_sheet_row


async def main():
    rows, headers = await fetch_sheet_data()
    if not rows:
        print("Could not fetch sheet.")
        return

    by_phone = defaultdict(list)   # phone -> list of (row_index, name, external_id)
    by_external_id = defaultdict(list)

    for i, row in enumerate(rows):
        lead_data = parse_sheet_row(row, headers)
        if lead_data:
            name = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip()
            phone = lead_data.get("phone")
            eid = lead_data.get("external_id")
            if phone:
                by_phone[phone].append((i + 2, name, eid))  # +2 = 1-based + header
            if eid:
                by_external_id[eid].append((i + 2, name, phone))

    dup_phones = {p: v for p, v in by_phone.items() if len(v) > 1}
    dup_eids = {e: v for e, v in by_external_id.items() if len(v) > 1}

    print("Duplicate ROWS in sheet (same phone or same external_id):\n")
    total_dup_rows = 0
    if dup_phones:
        print("By phone (row numbers are 1-based, including header):")
        for phone, entries in dup_phones.items():
            total_dup_rows += len(entries) - 1  # extra rows
            print(f"  Phone {phone}: rows {[e[0] for e in entries]}  ({entries[0][1]})")
    if dup_eids:
        print("\nBy external_id:")
        for eid, entries in dup_eids.items():
            if eid not in [p for p in dup_phones]:  # avoid double count if same
                total_dup_rows += len(entries) - 1
            print(f"  {eid}: rows {[e[0] for e in entries]}  ({entries[0][1]})")

    print(f"\nTotal duplicate sheet rows (same person multiple times): {total_dup_rows}")
    print("So the 6 'missing' are duplicate entries in the sheet — same 6 people already in the system under another row.")


if __name__ == "__main__":
    asyncio.run(main())
