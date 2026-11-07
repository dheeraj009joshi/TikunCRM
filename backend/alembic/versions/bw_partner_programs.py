"""Partner programs, lead deliveries, BDC coverage, and portal logins.

Revision ID: bw_partner_programs
Revises: bv_lead_last_inbound_at
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bw_partner_programs"
down_revision: Union[str, None] = "bv_lead_last_inbound_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "partner_programs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("partner_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("program_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("states", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("postal_codes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("min_credit_score", sa.Integer(), nullable=True),
        sa.Column("max_credit_score", sa.Integer(), nullable=True),
        sa.Column("min_down_payment", sa.Numeric(12, 2), nullable=True),
        sa.Column("daily_cap", sa.Integer(), nullable=True),
        sa.Column("monthly_cap", sa.Integer(), nullable=True),
        sa.Column("hours", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("timezone", sa.String(length=100), nullable=False, server_default="America/New_York"),
        sa.Column("priority_weight", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["partner_store_id"], ["partner_stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("partner_store_id", name="uq_partner_programs_store"),
    )
    op.create_index("ix_partner_programs_status", "partner_programs", ["status"])

    op.create_table(
        "lead_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("brand", sa.String(length=100), nullable=False),
        sa.Column("brand_key", sa.String(length=100), nullable=False),
        sa.Column("partner_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("program_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("bdc_agent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["partner_store_id"], ["partner_stores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bdc_agent_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_lead_deliveries_lead_id", "lead_deliveries", ["lead_id"])
    op.create_index("ix_lead_deliveries_customer_id", "lead_deliveries", ["customer_id"])
    op.create_index("ix_lead_deliveries_brand_key", "lead_deliveries", ["brand_key"])
    op.create_index("ix_lead_deliveries_partner_store_id", "lead_deliveries", ["partner_store_id"])
    op.create_index("ix_lead_deliveries_status", "lead_deliveries", ["status"])
    op.create_index("ix_lead_deliveries_bdc_agent_id", "lead_deliveries", ["bdc_agent_id"])
    op.create_index("ix_lead_deliveries_delivered_at", "lead_deliveries", ["delivered_at"])
    op.create_index(
        "uq_lead_deliveries_open_customer_brand",
        "lead_deliveries",
        ["customer_id", "brand_key"],
        unique=True,
        postgresql_where=sa.text("status NOT IN ('dead', 'returned')"),
    )
    op.create_index(
        "uq_lead_deliveries_open_full_bdc_customer",
        "lead_deliveries",
        ["customer_id"],
        unique=True,
        postgresql_where=sa.text(
            "program_type = 'full_bdc' AND status NOT IN ('dead', 'returned')"
        ),
    )

    op.create_table(
        "partner_bdc_agents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("partner_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("max_open_leads", sa.Integer(), nullable=False, server_default="15"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["partner_store_id"], ["partner_stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "partner_store_id", name="uq_partner_bdc_agent_store"),
    )
    op.create_index("ix_partner_bdc_agents_user_id", "partner_bdc_agents", ["user_id"])
    op.create_index("ix_partner_bdc_agents_partner_store_id", "partner_bdc_agents", ["partner_store_id"])

    op.create_table(
        "partner_portal_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("partner_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=True),
        sa.Column("last_name", sa.String(length=100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["partner_store_id"], ["partner_stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("email", name="uq_partner_portal_users_email"),
    )
    op.create_index("ix_partner_portal_users_partner_store_id", "partner_portal_users", ["partner_store_id"])
    op.create_index("ix_partner_portal_users_email", "partner_portal_users", ["email"])


def downgrade() -> None:
    op.drop_table("partner_portal_users")
    op.drop_table("partner_bdc_agents")
    op.drop_index("uq_lead_deliveries_open_full_bdc_customer", table_name="lead_deliveries")
    op.drop_index("uq_lead_deliveries_open_customer_brand", table_name="lead_deliveries")
    op.drop_table("lead_deliveries")
    op.drop_table("partner_programs")
