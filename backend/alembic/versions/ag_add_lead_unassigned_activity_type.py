"""Add LEAD_UNASSIGNED to activitytype enum

Revision ID: ag_lead_unassigned
Revises: af_credit_app_uppercase
Create Date: 2026-02-19

SQLAlchemy persists enum name by default; DB activitytype uses uppercase.
"""
from alembic import op

revision = "ag_lead_unassigned"
down_revision = "af_credit_app_uppercase"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'LEAD_UNASSIGNED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
