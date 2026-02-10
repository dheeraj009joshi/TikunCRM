"""Add LEAD_UPDATED to activitytype enum

Revision ID: y_lead_updated_activity
Revises: x_secondary_customer_on_lead
Create Date: 2026-02-08

"""
from alembic import op

revision = "y_lead_updated_activity"
down_revision = "x_secondary_customer_on_lead"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLAlchemy persists enum name by default; DB activitytype uses uppercase.
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'LEAD_UPDATED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
