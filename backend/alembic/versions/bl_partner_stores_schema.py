"""Add partner_stores schema BEFORE data consolidation.

Must run before bh_carvaminos so the deployed backend (which maps
partner columns on Lead) does not 500 while consolidation is pending.

Revision ID: bl_partner_stores
Revises: bg_lead_credit_apps
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "bl_partner_stores"
down_revision: Union[str, None] = "bg_lead_credit_apps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    exists = conn.execute(text(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'partner_stores'"
    )).fetchone()
    if not exists:
        op.create_table(
            "partner_stores",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("brand", sa.String(100), nullable=True, index=True),
            sa.Column("address", sa.Text(), nullable=True),
            sa.Column("city", sa.String(100), nullable=True),
            sa.Column("state", sa.String(100), nullable=True),
            sa.Column("country", sa.String(100), nullable=True, server_default="US"),
            sa.Column("postal_code", sa.String(20), nullable=True),
            sa.Column("phone", sa.String(20), nullable=True),
            sa.Column("email", sa.String(255), nullable=True),
            sa.Column("website", sa.String(255), nullable=True),
            sa.Column("contact_person", sa.String(255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text("NOW()")),
        )

    col = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'interested_brand'
    """)).fetchone()
    if not col:
        op.add_column("leads", sa.Column(
            "interested_brand", sa.String(100), nullable=True, index=True,
        ))
    col = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'partner_store_id'
    """)).fetchone()
    if not col:
        op.add_column("leads", sa.Column(
            "partner_store_id", postgresql.UUID(as_uuid=True), nullable=True, index=True,
        ))
    col = conn.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = 'partner_connected_at'
    """)).fetchone()
    if not col:
        op.add_column("leads", sa.Column(
            "partner_connected_at", sa.DateTime(timezone=True), nullable=True,
        ))

    fk = conn.execute(text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_partner_store_id'"
    )).fetchone()
    if not fk:
        op.create_foreign_key(
            "fk_leads_partner_store_id",
            "leads", "partner_stores",
            ["partner_store_id"], ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    conn = op.get_bind()
    fk = conn.execute(text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_partner_store_id'"
    )).fetchone()
    if fk:
        op.drop_constraint("fk_leads_partner_store_id", "leads", type_="foreignkey")
    for col in ("partner_connected_at", "partner_store_id", "interested_brand"):
        exists = conn.execute(text("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'leads' AND column_name = :col
        """), {"col": col}).fetchone()
        if exists:
            op.drop_column("leads", col)
    op.drop_table("partner_stores")
