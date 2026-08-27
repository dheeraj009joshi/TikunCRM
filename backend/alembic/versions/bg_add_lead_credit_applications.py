"""Add lead_credit_applications table for in-CRM credit apps

Revision ID: bg_lead_credit_apps
Revises: bf_softphone_presence
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "bg_lead_credit_apps"
down_revision: Union[str, None] = "bf_softphone_presence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lead_credit_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("transaction_type", sa.String(20), nullable=True),
        sa.Column("application_type", sa.String(20), nullable=True),
        sa.Column("app_number", sa.String(50), nullable=True),
        sa.Column("applicant_a", postgresql.JSONB(), nullable=True),
        sa.Column("applicant_b", postgresql.JSONB(), nullable=True),
        sa.Column("other_income", postgresql.JSONB(), nullable=True),
        sa.Column("reference", postgresql.JSONB(), nullable=True),
        sa.Column("bank_reference", postgresql.JSONB(), nullable=True),
        sa.Column("authorization", postgresql.JSONB(), nullable=True),
        sa.Column("dealer_section", postgresql.JSONB(), nullable=True),
        sa.Column("applicant_a_ssn_encrypted", sa.Text(), nullable=True),
        sa.Column("applicant_b_ssn_encrypted", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("lead_id", name="uq_lead_credit_applications_lead_id"),
    )
    op.create_index(
        "idx_lead_credit_applications_dealership",
        "lead_credit_applications",
        ["dealership_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_lead_credit_applications_dealership", table_name="lead_credit_applications")
    op.drop_table("lead_credit_applications")
