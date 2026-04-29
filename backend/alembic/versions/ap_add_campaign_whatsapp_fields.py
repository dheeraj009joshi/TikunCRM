"""Add WhatsApp template fields to campaign_mappings

Revision ID: ap_add_campaign_whatsapp_fields
Revises: ao_add_ai_outbound_calling
Create Date: 2026-04-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "ap_add_campaign_whatsapp_fields"
down_revision: Union[str, None] = "ao_add_ai_outbound_calling"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add whatsapp_template_id FK column
    op.add_column(
        "campaign_mappings",
        sa.Column(
            "whatsapp_template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("whatsapp_templates.id", ondelete="SET NULL"),
            nullable=True,
            comment="Default WhatsApp template for leads in this campaign",
        ),
    )
    op.create_index(
        "ix_campaign_mappings_whatsapp_template_id",
        "campaign_mappings",
        ["whatsapp_template_id"],
    )

    # Add whatsapp_auto_send boolean column
    op.add_column(
        "campaign_mappings",
        sa.Column(
            "whatsapp_auto_send",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment="Auto-send WhatsApp template when new lead matches this campaign",
        ),
    )


def downgrade() -> None:
    op.drop_column("campaign_mappings", "whatsapp_auto_send")
    op.drop_index("ix_campaign_mappings_whatsapp_template_id", table_name="campaign_mappings")
    op.drop_column("campaign_mappings", "whatsapp_template_id")
