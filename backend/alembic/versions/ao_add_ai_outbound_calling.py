"""add ai outbound calling support

Revision ID: ao_add_ai_outbound_calling
Revises: an_add_user_config_access_password
Create Date: 2026-04-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "ao_add_ai_outbound_calling"
down_revision: Union[str, None] = "an_add_user_config_access_password"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add ai_outbound_enabled to dealership_twilio_configs
    op.add_column(
        "dealership_twilio_configs",
        sa.Column(
            "ai_outbound_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="Enable AI outbound calling for new leads",
        ),
    )
    
    # Create ai_outbound_calls table for idempotency and state tracking
    op.create_table(
        "ai_outbound_calls",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "lead_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("leads.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
            comment="One AI outbound attempt per lead",
        ),
        sa.Column(
            "dealership_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealerships.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            index=True,
            comment="pending, dialing, in_progress, completed, failed, skipped_quiet_hours, skipped_no_phone, etc.",
        ),
        sa.Column(
            "twilio_call_sid",
            sa.String(64),
            nullable=True,
            index=True,
            comment="Twilio Call SID when dial is placed",
        ),
        sa.Column(
            "call_log_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("call_logs.id", ondelete="SET NULL"),
            nullable=True,
            comment="Reference to the CallLog row",
        ),
        sa.Column(
            "customer_phone",
            sa.String(32),
            nullable=True,
            comment="Phone dialed (E.164)",
        ),
        sa.Column(
            "scheduled_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the call was/will be attempted",
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When dial was initiated",
        ),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When call ended or failed",
        ),
        sa.Column(
            "outcome",
            sa.String(64),
            nullable=True,
            comment="qualified, booked, no_answer, voicemail, customer_declined, etc.",
        ),
        sa.Column(
            "notes",
            sa.Text(),
            nullable=True,
            comment="AI summary or error details",
        ),
        sa.Column(
            "meta_data",
            postgresql.JSONB(),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
            comment="Qualification data, appointment details, etc.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("timezone('utc', now())"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("timezone('utc', now())"),
        ),
    )
    
    # Create index for status queries
    op.create_index(
        "ix_ai_outbound_calls_status_created",
        "ai_outbound_calls",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_outbound_calls_status_created", table_name="ai_outbound_calls")
    op.drop_table("ai_outbound_calls")
    op.drop_column("dealership_twilio_configs", "ai_outbound_enabled")
