"""Add WHATSAPP_RECEIVED to activitytype enum

Revision ID: ar_whatsapp_received_activity
Revises: aq_widen_whatsapp_phone_columns
Create Date: 2026-04-29

SQLAlchemy persists ActivityType enum *member names* to PostgreSQL (e.g. WHATSAPP_RECEIVED).
Initial schema had WHATSAPP_SENT but not WHATSAPP_RECEIVED; inbound WhatsApp activity logging failed.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "ar_whatsapp_received_activity"
down_revision: Union[str, None] = "aq_widen_whatsapp_phone_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'WHATSAPP_RECEIVED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
