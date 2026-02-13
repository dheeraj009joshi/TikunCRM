"""Add CREDIT_APP_* enum values in uppercase for activitytype (SQLAlchemy sends enum name)

Revision ID: af_credit_app_uppercase
Revises: ae_credit_app_activity
Create Date: 2026-02-12

"""
from alembic import op

revision = "af_credit_app_uppercase"
down_revision = "ae_credit_app_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # App sends enum names (uppercase); DB must accept them
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'CREDIT_APP_INITIATED'")
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'CREDIT_APP_COMPLETED'")
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'CREDIT_APP_ABANDONED'")


def downgrade() -> None:
    pass
