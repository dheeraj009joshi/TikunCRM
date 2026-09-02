"""
Verify activities exist for leads after Carvaminos consolidation.

Usage (from backend/):
    python -m scripts.verify_activities

Optional: repair mismatched activity.dealership_id from leads:
    python -m scripts.verify_activities --repair
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, text

from scripts.carvaminos_consolidation import _sync_database_url


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repair", action="store_true", help="Align activity.dealership_id from leads")
    args = parser.parse_args()

    from app.core.config import settings

    engine = create_engine(
        _sync_database_url(settings.database_url),
        connect_args={"connect_timeout": 60, "options": "-c statement_timeout=0"},
    )

    with engine.connect() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM activities")).scalar() or 0
        with_lead = conn.execute(
            text("SELECT COUNT(*) FROM activities WHERE lead_id IS NOT NULL")
        ).scalar() or 0
        mismatched = conn.execute(text("""
            SELECT COUNT(*) FROM activities a
            JOIN leads l ON l.id = a.lead_id
            WHERE a.dealership_id IS DISTINCT FROM l.dealership_id
        """)).scalar() or 0
        orphaned_lead = conn.execute(text("""
            SELECT COUNT(*) FROM activities a
            LEFT JOIN leads l ON l.id = a.lead_id
            WHERE a.lead_id IS NOT NULL AND l.id IS NULL
        """)).scalar() or 0

        sample = conn.execute(text("""
            SELECT l.id, COUNT(a.id) AS activity_count
            FROM leads l
            LEFT JOIN activities a ON a.lead_id = l.id
            GROUP BY l.id
            HAVING COUNT(a.id) > 0
            ORDER BY COUNT(a.id) DESC
            LIMIT 5
        """)).fetchall()

        print(f"Total activities:           {total}")
        print(f"With lead_id:               {with_lead}")
        print(f"dealership_id mismatched:   {mismatched}")
        print(f"Orphan lead_id (no lead):   {orphaned_lead}")
        print("\nTop leads by activity count:")
        for row in sample:
            print(f"  {row[0]} → {row[1]} activities")

        if args.repair and mismatched:
            result = conn.execute(text("""
                UPDATE activities a
                SET dealership_id = l.dealership_id
                FROM leads l
                WHERE a.lead_id = l.id
                  AND (a.dealership_id IS DISTINCT FROM l.dealership_id)
            """))
            conn.commit()
            print(f"\nRepaired {result.rowcount or 0} activity rows.")

        if total == 0:
            print("\nWARNING: No activities in database.", file=sys.stderr)
            return 1
        if with_lead == 0:
            print("\nWARNING: No activities linked to leads (lead_id all NULL).", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
