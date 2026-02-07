"""Add uppercase values to showroomoutcome enum for SQLAlchemy compatibility

SQLAlchemy sends Python enum names (SOLD, RESCHEDULE, etc.). Add uppercase values.

Revision ID: p3456789012m
Revises: o2345678901l
Create Date: 2026-02-07

"""
from alembic import op

revision = 'p3456789012m'
down_revision = 'o2345678901l'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for value in ('SOLD', 'NOT_INTERESTED', 'FOLLOW_UP', 'RESCHEDULE', 'BROWSING'):
        op.execute(f"ALTER TYPE showroomoutcome ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; leave as-is
    pass
