"""Add STIP_DOCUMENT_ADDED and STIP_DOCUMENT_REMOVED to activitytype enum

Revision ID: ad_stip_document_activity
Revises: ac_stips_tables
Create Date: 2026-02-10

"""
from alembic import op

revision = "ad_stip_document_activity"
down_revision = "ac_stips_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'STIP_DOCUMENT_ADDED'")
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'STIP_DOCUMENT_REMOVED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
