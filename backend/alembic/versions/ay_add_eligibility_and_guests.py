"""Add eligibility engine tables, guests table, and capture fields

Revision ID: ay_eligibility_guests
Revises: ax_add_bdc_role
Create Date: 2026-06-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "ay_eligibility_guests"
down_revision: Union[str, None] = "ax_add_bdc_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Capture fields for auto criteria ---
    op.add_column("customers", sa.Column("credit_score", sa.Integer(), nullable=True))
    op.add_column("customers", sa.Column("has_license", sa.Boolean(), nullable=True))
    op.add_column("leads", sa.Column("down_payment", sa.Numeric(12, 2), nullable=True))

    # --- eligibility_criteria ---
    op.create_table(
        "eligibility_criteria",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(100), nullable=False, server_default="General"),
        sa.Column("weight", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("input_type", sa.String(20), nullable=False, server_default="boolean"),
        sa.Column("value_source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("auto_field", sa.String(100), nullable=True),
        sa.Column("config", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_eligibility_criteria_dealership", "eligibility_criteria", ["dealership_id"])

    # --- eligibility_assessment ---
    op.create_table(
        "eligibility_assessment",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("total_score", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("raw_points", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("max_points", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("last_updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["last_updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("entity_type", "entity_id", name="uq_eligibility_assessment_entity"),
    )
    op.create_index("idx_eligibility_assessment_entity", "eligibility_assessment", ["entity_type", "entity_id"])
    op.create_index("idx_eligibility_assessment_dealership", "eligibility_assessment", ["dealership_id"])

    # --- eligibility_assessment_item ---
    op.create_table(
        "eligibility_assessment_item",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assessment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("criterion_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_met", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("value", postgresql.JSONB(), nullable=True),
        sa.Column("is_override", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("points", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("checked_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["assessment_id"], ["eligibility_assessment.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["criterion_id"], ["eligibility_criteria.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["checked_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("assessment_id", "criterion_id", name="uq_eligibility_item_assessment_criterion"),
    )
    op.create_index("idx_eligibility_item_assessment", "eligibility_assessment_item", ["assessment_id"])
    op.create_index("idx_eligibility_item_criterion", "eligibility_assessment_item", ["criterion_id"])

    # --- guests ---
    op.create_table(
        "guests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("address", sa.String(500), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("state", sa.String(100), nullable=True),
        sa.Column("postal_code", sa.String(20), nullable=True),
        sa.Column("down_payment", sa.Numeric(12, 2), nullable=True),
        sa.Column("vehicle_of_interest", sa.String(255), nullable=True),
        sa.Column("trade_in", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("share_token", sa.String(64), nullable=True),
        sa.Column("share_revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("share_token", name="uq_guests_share_token"),
    )
    op.create_index("idx_guests_dealership", "guests", ["dealership_id"])
    op.create_index("idx_guests_lead", "guests", ["lead_id"])
    op.create_index("idx_guests_appointment", "guests", ["appointment_id"])
    op.create_index("idx_guests_share_token", "guests", ["share_token"])


def downgrade() -> None:
    op.drop_table("guests")
    op.drop_table("eligibility_assessment_item")
    op.drop_table("eligibility_assessment")
    op.drop_table("eligibility_criteria")
    op.drop_column("leads", "down_payment")
    op.drop_column("customers", "has_license")
    op.drop_column("customers", "credit_score")
