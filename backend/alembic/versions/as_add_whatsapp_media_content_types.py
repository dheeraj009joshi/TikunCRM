"""Add media_content_types column to whatsapp_logs

Revision ID: as_whatsapp_media_types
Revises: ar_whatsapp_received_activity
Create Date: 2026-04-29

Stores MIME types (image/jpeg, video/mp4, audio/ogg, etc.) for media attachments.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "as_whatsapp_media_types"
down_revision: Union[str, None] = "ar_whatsapp_received_activity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "whatsapp_logs",
        sa.Column("media_content_types", JSONB, nullable=True, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("whatsapp_logs", "media_content_types")
