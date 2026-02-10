"""Add whatsapp_logs table for Twilio WhatsApp messaging

Revision ID: aa_whatsapp_logs
Revises: z_customer_sms_call
Create Date: 2026-01-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import text

revision = "aa_whatsapp_logs"
down_revision = "z_customer_sms_call"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enums only if they don't exist (idempotent for re-runs)
    conn = op.get_bind()
    conn.execute(text(
        "DO $$ BEGIN CREATE TYPE whatsappdirection AS ENUM ('inbound', 'outbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    ))
    conn.execute(text(
        "DO $$ BEGIN CREATE TYPE whatsappstatus AS ENUM ('queued', 'sending', 'sent', 'delivered', 'read', 'undelivered', 'failed', 'received'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    ))

    # Use postgresql.ENUM with create_type=False so table create does not emit CREATE TYPE
    whatsapp_direction_type = postgresql.ENUM("inbound", "outbound", name="whatsappdirection", create_type=False)
    whatsapp_status_type = postgresql.ENUM("queued", "sending", "sent", "delivered", "read", "undelivered", "failed", "received", name="whatsappstatus", create_type=False)

    op.create_table(
        "whatsapp_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("twilio_message_sid", sa.String(64), nullable=False),
        sa.Column("direction", whatsapp_direction_type, nullable=False),
        sa.Column("from_number", sa.String(20), nullable=False),
        sa.Column("to_number", sa.String(20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("media_urls", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("status", whatsapp_status_type, nullable=False),
        sa.Column("error_code", sa.String(10), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta_data", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("activity_logged", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_whatsapp_logs_customer_id", "whatsapp_logs", ["customer_id"])
    op.create_index("ix_whatsapp_logs_lead_id", "whatsapp_logs", ["lead_id"])
    op.create_index("ix_whatsapp_logs_user_id", "whatsapp_logs", ["user_id"])
    op.create_index("ix_whatsapp_logs_dealership_id", "whatsapp_logs", ["dealership_id"])
    op.create_index("ix_whatsapp_logs_twilio_message_sid", "whatsapp_logs", ["twilio_message_sid"], unique=True)
    op.create_index("ix_whatsapp_logs_direction", "whatsapp_logs", ["direction"])
    op.create_index("ix_whatsapp_logs_status", "whatsapp_logs", ["status"])
    op.create_index("ix_whatsapp_logs_is_read", "whatsapp_logs", ["is_read"])
    op.create_index("ix_whatsapp_logs_created_at", "whatsapp_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_whatsapp_logs_created_at", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_is_read", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_status", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_direction", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_twilio_message_sid", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_dealership_id", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_user_id", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_lead_id", table_name="whatsapp_logs")
    op.drop_index("ix_whatsapp_logs_customer_id", table_name="whatsapp_logs")
    op.drop_table("whatsapp_logs")
    op.execute("DROP TYPE whatsappstatus")
    op.execute("DROP TYPE whatsappdirection")
