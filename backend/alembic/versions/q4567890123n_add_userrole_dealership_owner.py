"""Add DEALERSHIP_OWNER to userrole enum

Revision ID: q4567890123n
Revises: p3456789012m
Create Date: 2026-02-07

"""
from alembic import op

revision = 'q4567890123n'
down_revision = 'p3456789012m'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'DEALERSHIP_OWNER'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; leave as-is
    pass
