"""Add lead status values for showroom outcomes (COULDNT_QUALIFY, BROWSING, RESCHEDULE)

Outcome status is part of lead status; checkout sets lead status to the outcome.

Revision ID: v9012345678s
Revises: u8901234567r
Create Date: 2026-02-07

"""
from alembic import op

revision = "v9012345678s"
down_revision = "u8901234567r"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for value in ("COULDNT_QUALIFY", "BROWSING", "RESCHEDULE"):
        op.execute(f"ALTER TYPE leadstatus ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    pass
