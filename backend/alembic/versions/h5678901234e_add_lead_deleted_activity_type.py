"""Add LEAD_DELETED to ActivityType enum

Revision ID: h5678901234e
Revises: g4567890123d
Create Date: 2026-01-28 21:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'h5678901234e'
down_revision = 'g4567890123d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add LEAD_DELETED value to activitytype enum
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'LEAD_DELETED'")


def downgrade() -> None:
    # Note: PostgreSQL doesn't support removing enum values easily
    # This would require recreating the enum type
    pass
