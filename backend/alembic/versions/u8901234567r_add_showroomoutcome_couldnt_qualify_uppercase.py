"""Add COULDNT_QUALIFY uppercase to showroomoutcome for SQLAlchemy

SQLAlchemy may send Python enum names (COULDNT_QUALIFY). Add uppercase value.

Revision ID: u8901234567r
Revises: t7890123456q
Create Date: 2026-02-07

"""
from alembic import op

revision = "u8901234567r"
down_revision = "t7890123456q"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE showroomoutcome ADD VALUE IF NOT EXISTS 'COULDNT_QUALIFY'")


def downgrade() -> None:
    pass
