"""Simplify roles for single-org Carvaminos model.

Merges DEALERSHIP_OWNER into DEALERSHIP_ADMIN (functionally identical now).
All users already belong to the single Carvaminos dealership from bh_carvaminos.
SUPER_ADMIN users get their dealership_id set to Carvaminos (no more NULL).

Revision ID: bj_simplify_roles
Revises: bi_partner_stores
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bj_simplify_roles"
down_revision: Union[str, None] = "bi_partner_stores"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CARVAMINOS_ID = "00000000-0000-4000-a000-000000000001"


def upgrade() -> None:
    conn = op.get_bind()

    # Resolve the actual Carvaminos id (may differ if slug already existed)
    row = conn.execute(
        text("SELECT id FROM dealerships WHERE slug = 'carvaminos' AND is_active = true")
    ).fetchone()
    cid = str(row[0]) if row else CARVAMINOS_ID

    # Merge DEALERSHIP_OWNER → DEALERSHIP_ADMIN
    conn.execute(text("""
        UPDATE users SET role = 'DEALERSHIP_ADMIN', updated_at = NOW()
        WHERE role = 'DEALERSHIP_OWNER'
    """))

    # Point super-admin users to Carvaminos (no more NULL dealership_id)
    conn.execute(text("""
        UPDATE users SET dealership_id = :cid, updated_at = NOW()
        WHERE dealership_id IS NULL
    """), {"cid": cid})


def downgrade() -> None:
    pass
