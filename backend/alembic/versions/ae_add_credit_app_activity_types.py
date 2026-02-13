"""Add CREDIT_APP_INITIATED, CREDIT_APP_COMPLETED, CREDIT_APP_ABANDONED to activitytype enum

Revision ID: ae_credit_app_activity
Revises: ad_stip_document_activity
Create Date: 2026-01-28

"""
from alembic import op

revision = "ae_credit_app_activity"
down_revision = "ad_stip_document_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use uppercase to match SQLAlchemy enum names (same as STIP_DOCUMENT_ADDED, etc.)
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'CREDIT_APP_INITIATED'")
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'CREDIT_APP_COMPLETED'")
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'CREDIT_APP_ABANDONED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
