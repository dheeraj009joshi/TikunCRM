"""Add showroomoutcome value 'couldnt_qualify'

Revision ID: t7890123456q
Revises: s6789012345p
Create Date: 2026-02-07

"""
from alembic import op

revision = "t7890123456q"
down_revision = "s6789012345p"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE showroomoutcome ADD VALUE IF NOT EXISTS 'couldnt_qualify'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; leave as-is
    pass
