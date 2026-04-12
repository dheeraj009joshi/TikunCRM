"""add dealership_twilio_configs

Revision ID: al_add_dealership_twilio_configs
Revises: ak_add_lead_campaigns_multi_tracking
Create Date: 2026-04-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "al_add_dealership_twilio_configs"
down_revision: Union[str, None] = "ak_add_lead_campaigns_multi_tracking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dealership_twilio_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_sid", sa.String(length=64), nullable=True),
        sa.Column("auth_token", sa.Text(), nullable=True, comment="Encrypted Twilio auth token"),
        sa.Column("sms_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sms_from_number", sa.String(length=32), nullable=True),
        sa.Column("whatsapp_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("whatsapp_from_number", sa.String(length=32), nullable=True),
        sa.Column("voice_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("twilio_twiml_app_sid", sa.String(length=64), nullable=True),
        sa.Column("twilio_api_key_sid", sa.String(length=64), nullable=True),
        sa.Column(
            "twilio_api_key_secret",
            sa.Text(),
            nullable=True,
            comment="Encrypted API Key Secret for WebRTC tokens",
        ),
        sa.Column("voice_caller_id_number", sa.String(length=32), nullable=True),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dealership_id"),
    )
    op.create_index(
        op.f("ix_dealership_twilio_configs_dealership_id"),
        "dealership_twilio_configs",
        ["dealership_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_dealership_twilio_configs_dealership_id"),
        table_name="dealership_twilio_configs",
    )
    op.drop_table("dealership_twilio_configs")
