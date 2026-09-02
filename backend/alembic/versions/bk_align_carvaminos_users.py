"""Align all users and leads to the active Carvaminos dealership.

Safety net after single-org consolidation — ensures user.dealership_id
matches the org where leads live, even if bh/bj migrations were partial.

Revision ID: bk_align_carvaminos
Revises: bj_simplify_roles
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bk_align_carvaminos"
down_revision: Union[str, None] = "bj_simplify_roles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    row = conn.execute(
        text(
            "SELECT id FROM dealerships "
            "WHERE slug = 'carvaminos' AND is_active = true "
            "ORDER BY created_at LIMIT 1"
        )
    ).fetchone()

    if not row:
        # Fall back to any active dealership if slug missing
        row = conn.execute(
            text(
                "SELECT id FROM dealerships "
                "WHERE is_active = true "
                "ORDER BY created_at LIMIT 1"
            )
        ).fetchone()

    if not row:
        return

    cid = str(row[0])

    # Point all active users at Carvaminos
    conn.execute(text("""
        UPDATE users
        SET dealership_id = :cid, updated_at = NOW()
        WHERE is_active = true
          AND (dealership_id IS NULL OR dealership_id != :cid)
    """), {"cid": cid})

    # Ensure no orphaned leads outside the active org
    conn.execute(text("""
        UPDATE leads
        SET dealership_id = :cid
        WHERE dealership_id IS NULL OR dealership_id != :cid
    """), {"cid": cid})


def downgrade() -> None:
    pass
