"""Widen WhatsApp phone columns for Twilio whatsapp:+ URI format

Revision ID: aq_widen_whatsapp_phone_columns
Revises: ap_add_campaign_whatsapp_fields
Create Date: 2026-04-29

Twilio stores WhatsApp addresses as e.g. whatsapp:+14043416725 (21 chars),
which exceeds varchar(20).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "aq_widen_whatsapp_phone_columns"
down_revision: Union[str, None] = "ap_add_campaign_whatsapp_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "whatsapp_logs",
        "from_number",
        existing_type=sa.String(20),
        type_=sa.String(32),
        existing_nullable=False,
    )
    op.alter_column(
        "whatsapp_logs",
        "to_number",
        existing_type=sa.String(20),
        type_=sa.String(32),
        existing_nullable=False,
    )
    op.alter_column(
        "whatsapp_messages",
        "phone_number",
        existing_type=sa.String(20),
        type_=sa.String(32),
        existing_nullable=False,
    )
    op.alter_column(
        "whatsapp_messages",
        "from_number",
        existing_type=sa.String(20),
        type_=sa.String(32),
        existing_nullable=True,
    )
    op.alter_column(
        "whatsapp_messages",
        "to_number",
        existing_type=sa.String(20),
        type_=sa.String(32),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "whatsapp_messages",
        "to_number",
        existing_type=sa.String(32),
        type_=sa.String(20),
        existing_nullable=True,
    )
    op.alter_column(
        "whatsapp_messages",
        "from_number",
        existing_type=sa.String(32),
        type_=sa.String(20),
        existing_nullable=True,
    )
    op.alter_column(
        "whatsapp_messages",
        "phone_number",
        existing_type=sa.String(32),
        type_=sa.String(20),
        existing_nullable=False,
    )
    op.alter_column(
        "whatsapp_logs",
        "to_number",
        existing_type=sa.String(32),
        type_=sa.String(20),
        existing_nullable=False,
    )
    op.alter_column(
        "whatsapp_logs",
        "from_number",
        existing_type=sa.String(32),
        type_=sa.String(20),
        existing_nullable=False,
    )
