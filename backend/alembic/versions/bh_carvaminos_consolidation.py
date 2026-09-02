"""Consolidate all data into single Carvaminos organization.

Heavy data work should be run FIRST via the production-safe script:

    cd backend && python -m scripts.carvaminos_consolidation

Then stamp this revision if the script completed:

    alembic stamp bh_carvaminos

This Alembic revision is a lightweight fallback / idempotent re-check only.

Revision ID: bh_carvaminos
Revises: bg_lead_credit_apps
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bh_carvaminos"
down_revision: Union[str, None] = "bg_lead_credit_apps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    If consolidation was already applied by scripts/carvaminos_consolidation.py,
    this is a no-op. Otherwise attempt the same logic (may timeout on huge DBs
    under async — prefer the script).
    """
    conn = op.get_bind()
    conn.execute(text("SET statement_timeout TO 0"))
    conn.execute(text("SET lock_timeout TO 0"))

    row = conn.execute(
        text("SELECT id FROM dealerships WHERE slug = 'carvaminos' AND is_active = true")
    ).fetchone()
    if not row:
        # Not consolidated yet — tell operator to run the script
        raise RuntimeError(
            "Carvaminos consolidation not applied. Run:\n"
            "  cd backend && python -m scripts.carvaminos_consolidation\n"
            "  alembic stamp bh_carvaminos\n"
            "  alembic upgrade head"
        )

    cid = str(row[0])
    orphans = conn.execute(
        text("SELECT COUNT(*) FROM leads WHERE dealership_id IS DISTINCT FROM :cid"),
        {"cid": cid},
    ).scalar()
    if orphans and orphans > 0:
        raise RuntimeError(
            f"Carvaminos exists but {orphans} leads still on other dealerships. "
            "Run: python -m scripts.carvaminos_consolidation"
        )


def downgrade() -> None:
    pass
