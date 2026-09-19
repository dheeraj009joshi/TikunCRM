"""Add sold_partner_store_id to snapshot partner at conversion.

Revision ID: br_lead_sold_partner_store
Revises: bq_activities_user_created_idx
Create Date: 2026-09-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "br_lead_sold_partner_store"
down_revision: Union[str, None] = "bq_activities_user_created_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    col = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'sold_partner_store_id'
    """)).fetchone()
    if not col:
        op.add_column(
            "leads",
            sa.Column(
                "sold_partner_store_id",
                postgresql.UUID(as_uuid=True),
                nullable=True,
            ),
        )

    idx = conn.execute(text("""
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'leads' AND indexname = 'ix_leads_sold_partner_store_id'
    """)).fetchone()
    if not idx:
        op.create_index(
            "ix_leads_sold_partner_store_id",
            "leads",
            ["sold_partner_store_id"],
            unique=False,
        )

    fk = conn.execute(text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_sold_partner_store_id'"
    )).fetchone()
    if not fk:
        op.create_foreign_key(
            "fk_leads_sold_partner_store_id",
            "leads",
            "partner_stores",
            ["sold_partner_store_id"],
            ["id"],
            ondelete="SET NULL",
        )

    conn.execute(text("""
        UPDATE leads
        SET sold_partner_store_id = partner_store_id
        WHERE sold_partner_store_id IS NULL
          AND partner_store_id IS NOT NULL
          AND (outcome = 'converted' OR converted_at IS NOT NULL)
    """))


def downgrade() -> None:
    conn = op.get_bind()
    fk = conn.execute(text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_sold_partner_store_id'"
    )).fetchone()
    if fk:
        op.drop_constraint("fk_leads_sold_partner_store_id", "leads", type_="foreignkey")
    idx = conn.execute(text("""
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'leads' AND indexname = 'ix_leads_sold_partner_store_id'
    """)).fetchone()
    if idx:
        op.drop_index("ix_leads_sold_partner_store_id", table_name="leads")
    col = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'sold_partner_store_id'
    """)).fetchone()
    if col:
        op.drop_column("leads", "sold_partner_store_id")
