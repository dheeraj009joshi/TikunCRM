"""Add whatsapp_inbound and sms_inbound to leadsource enum

Revision ID: at_add_leadsource_inbound
Revises: ar_whatsapp_received_activity
Create Date: 2026-04-30

The Python LeadSource enum has WHATSAPP_INBOUND and SMS_INBOUND values,
but these were never added to the PostgreSQL leadsource enum type.
This causes incoming WhatsApp auto-lead creation to fail.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "at_add_leadsource_inbound"
down_revision: Union[str, None] = "ar_whatsapp_received_activity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE leadsource ADD VALUE IF NOT EXISTS 'whatsapp_inbound'")
    op.execute("ALTER TYPE leadsource ADD VALUE IF NOT EXISTS 'sms_inbound'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
