"""Partner stores schema (no-op if bl_partner_stores already applied).

Revision ID: bi_partner_stores
Revises: bh_carvaminos
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bi_partner_stores"
down_revision: Union[str, None] = "bh_carvaminos"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Schema is created in bl_partner_stores — this revision is a no-op safety net."""
    conn = op.get_bind()
    exists = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'partner_store_id'
    """)).fetchone()
    if not exists:
        raise RuntimeError(
            "partner_store_id column missing. Run: alembic upgrade bl_partner_stores"
        )


def downgrade() -> None:
    pass
