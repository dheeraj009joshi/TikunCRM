"""Add IN_SHOWROOM (uppercase) to leadstatus for SQLAlchemy compatibility

The initial schema uses uppercase enum values (NEW, CONTACTED, etc.).
SQLAlchemy sends the Python enum name (IN_SHOWROOM). Add uppercase value.

Revision ID: o2345678901l
Revises: n1234567890k
Create Date: 2026-02-07

"""
from alembic import op

revision = 'o2345678901l'
down_revision = 'n1234567890k'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # leadstatus in DB uses uppercase (NEW, CONTACTED, ...). Add IN_SHOWROOM.
    op.execute("ALTER TYPE leadstatus ADD VALUE IF NOT EXISTS 'IN_SHOWROOM'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values easily; leave as-is
    pass
