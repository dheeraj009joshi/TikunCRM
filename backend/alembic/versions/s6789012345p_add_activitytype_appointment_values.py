"""Add appointment activity types to activitytype enum

Revision ID: s6789012345p
Revises: r5678901234o
Create Date: 2026-02-07

"""
from alembic import op

revision = 's6789012345p'
down_revision = 'r5678901234o'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for value in ('APPOINTMENT_SCHEDULED', 'APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELLED'):
        op.execute(f"ALTER TYPE activitytype ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; leave as-is
    pass
