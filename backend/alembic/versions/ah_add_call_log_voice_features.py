"""Add call_log voice features: answered_by, requires_lead_details, recording_upload_status

Revision ID: ah_add_call_log_voice_features
Revises: ag_add_lead_unassigned_activity_type
Create Date: 2026-01-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "ah_add_call_log_voice_features"
down_revision = "ag_lead_unassigned"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add answered_by column (who actually answered the call in ring groups)
    op.add_column(
        "call_logs",
        sa.Column(
            "answered_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_call_logs_answered_by", "call_logs", ["answered_by"])

    # Add requires_lead_details flag (for unknown callers needing post-call lead info)
    op.add_column(
        "call_logs",
        sa.Column(
            "requires_lead_details",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # Add recording_upload_status (pending, uploading, completed, failed)
    op.add_column(
        "call_logs",
        sa.Column(
            "recording_upload_status",
            sa.String(20),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_call_logs_answered_by", table_name="call_logs")
    op.drop_column("call_logs", "answered_by")
    op.drop_column("call_logs", "requires_lead_details")
    op.drop_column("call_logs", "recording_upload_status")
