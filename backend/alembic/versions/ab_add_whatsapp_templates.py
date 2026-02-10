"""Add whatsapp_templates table for WhatsApp Content Template metadata

Revision ID: ab_whatsapp_templates
Revises: aa_whatsapp_logs
Create Date: 2026-02-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ab_whatsapp_templates"
down_revision = "aa_whatsapp_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_sid", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("variable_names", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_whatsapp_templates_content_sid", "whatsapp_templates", ["content_sid"])
    op.create_index("ix_whatsapp_templates_dealership_id", "whatsapp_templates", ["dealership_id"])


def downgrade() -> None:
    op.drop_index("ix_whatsapp_templates_dealership_id", table_name="whatsapp_templates")
    op.drop_index("ix_whatsapp_templates_content_sid", table_name="whatsapp_templates")
    op.drop_table("whatsapp_templates")
