"""
Add partner_stores table + lead partner columns if missing.

Run this FIRST on production when leads/follow-ups APIs return 500
because the backend expects columns that migrations haven't applied yet.

Usage (from backend/):
    python -m scripts.ensure_partner_schema
"""
from __future__ import annotations

import sys

from sqlalchemy import create_engine, text

from scripts.carvaminos_consolidation import _sync_database_url


def ensure_partner_schema(conn) -> None:
    """Idempotent — safe to run multiple times."""
    conn.execute(text("SET statement_timeout TO 0"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS partner_stores (
            id UUID PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            brand VARCHAR(100),
            address TEXT,
            city VARCHAR(100),
            state VARCHAR(100),
            country VARCHAR(100) DEFAULT 'US',
            postal_code VARCHAR(20),
            phone VARCHAR(20),
            email VARCHAR(255),
            website VARCHAR(255),
            contact_person VARCHAR(255),
            notes TEXT,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_partner_stores_brand ON partner_stores (brand)"
    ))

    conn.execute(text("""
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS interested_brand VARCHAR(100)
    """))
    conn.execute(text("""
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_store_id UUID
    """))
    conn.execute(text("""
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_connected_at TIMESTAMPTZ
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_leads_interested_brand ON leads (interested_brand)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_leads_partner_store_id ON leads (partner_store_id)"
    ))

    fk_exists = conn.execute(text("""
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_partner_store_id'
    """)).fetchone()
    if not fk_exists:
        conn.execute(text("""
            ALTER TABLE leads
            ADD CONSTRAINT fk_leads_partner_store_id
            FOREIGN KEY (partner_store_id) REFERENCES partner_stores (id)
            ON DELETE SET NULL
        """))


def main() -> int:
    from app.core.config import settings

    url = _sync_database_url(settings.database_url)
    print("Ensuring partner_stores schema…")
    engine = create_engine(
        url,
        connect_args={"connect_timeout": 60, "options": "-c statement_timeout=0"},
    )
    try:
        with engine.connect() as conn:
            ensure_partner_schema(conn)
            conn.commit()
        print("✓ partner_stores table and lead columns are present")
        print("\nRestart the backend, then run consolidation if needed:")
        print("  python -m scripts.carvaminos_consolidation")
        return 0
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
