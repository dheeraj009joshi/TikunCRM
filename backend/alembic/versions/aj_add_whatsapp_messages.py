"""Add whatsapp_messages table for Baileys WhatsApp messaging

Revision ID: aj_add_whatsapp_messages
Revises: ai_add_lead_sync_sources
Create Date: 2026-01-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import text

revision = "aj_add_whatsapp_messages"
down_revision = "ai_add_lead_sync_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum for message channel (baileys vs twilio)
    conn = op.get_bind()
    conn.execute(text(
        "DO $$ BEGIN CREATE TYPE whatsappchannel AS ENUM ('baileys', 'twilio'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    ))

    wa_channel_type = postgresql.ENUM("baileys", "twilio", name="whatsappchannel", create_type=False)
    # Reuse existing enums from whatsapp_logs
    wa_direction_type = postgresql.ENUM("inbound", "outbound", name="whatsappdirection", create_type=False)
    wa_status_type = postgresql.ENUM(
        "queued", "sending", "sent", "delivered", "read", "undelivered", "failed", "received",
        name="whatsappstatus", create_type=False
    )

    op.create_table(
        "whatsapp_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        # Baileys-specific fields
        sa.Column("wa_message_id", sa.String(128), nullable=True, comment="WhatsApp message ID from Baileys"),
        sa.Column("channel", wa_channel_type, nullable=False, server_default="baileys"),
        # Phone numbers
        sa.Column("phone_number", sa.String(20), nullable=False, comment="Remote party phone number"),
        sa.Column("from_number", sa.String(20), nullable=True),
        sa.Column("to_number", sa.String(20), nullable=True),
        # Message content
        sa.Column("direction", wa_direction_type, nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("media_url", sa.String(500), nullable=True),
        sa.Column("media_type", sa.String(50), nullable=True, comment="e.g. image, video, audio, document"),
        # Status tracking
        sa.Column("status", wa_status_type, nullable=False, server_default="queued"),
        sa.Column("error_message", sa.Text(), nullable=True),
        # Bulk send tracking
        sa.Column("bulk_send_id", postgresql.UUID(as_uuid=True), nullable=True, comment="Groups messages from same bulk send"),
        # Read tracking
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        # Timestamps
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        # Metadata for raw Baileys data
        sa.Column("meta_data", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        # Keys
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Indexes
    op.create_index("ix_whatsapp_messages_customer_id", "whatsapp_messages", ["customer_id"])
    op.create_index("ix_whatsapp_messages_lead_id", "whatsapp_messages", ["lead_id"])
    op.create_index("ix_whatsapp_messages_user_id", "whatsapp_messages", ["user_id"])
    op.create_index("ix_whatsapp_messages_dealership_id", "whatsapp_messages", ["dealership_id"])
    op.create_index("ix_whatsapp_messages_wa_message_id", "whatsapp_messages", ["wa_message_id"])
    op.create_index("ix_whatsapp_messages_phone_number", "whatsapp_messages", ["phone_number"])
    op.create_index("ix_whatsapp_messages_direction", "whatsapp_messages", ["direction"])
    op.create_index("ix_whatsapp_messages_status", "whatsapp_messages", ["status"])
    op.create_index("ix_whatsapp_messages_bulk_send_id", "whatsapp_messages", ["bulk_send_id"])
    op.create_index("ix_whatsapp_messages_is_read", "whatsapp_messages", ["is_read"])
    op.create_index("ix_whatsapp_messages_created_at", "whatsapp_messages", ["created_at"])

    # Create whatsapp_bulk_sends table to track bulk message campaigns
    op.create_table(
        "whatsapp_bulk_sends",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, comment="Admin who initiated"),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(255), nullable=True, comment="Optional name for campaign"),
        sa.Column("message_template", sa.Text(), nullable=False, comment="Message content sent"),
        # Filter criteria used
        sa.Column("filter_criteria", postgresql.JSONB(), nullable=False, server_default="{}", comment="Status/filters used to select recipients"),
        # Stats
        sa.Column("total_recipients", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivered_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        # Status: pending, in_progress, completed, cancelled
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        # Keys
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_whatsapp_bulk_sends_user_id", "whatsapp_bulk_sends", ["user_id"])
    op.create_index("ix_whatsapp_bulk_sends_dealership_id", "whatsapp_bulk_sends", ["dealership_id"])
    op.create_index("ix_whatsapp_bulk_sends_status", "whatsapp_bulk_sends", ["status"])
    op.create_index("ix_whatsapp_bulk_sends_created_at", "whatsapp_bulk_sends", ["created_at"])

    # Create whatsapp_connection table to track connection state
    op.create_table(
        "whatsapp_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True, comment="Null for global connection"),
        sa.Column("phone_number", sa.String(20), nullable=True, comment="Connected phone number"),
        sa.Column("status", sa.String(20), nullable=False, server_default="disconnected"),
        sa.Column("last_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_disconnected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_data", postgresql.JSONB(), nullable=True, comment="Session metadata"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_whatsapp_connections_dealership_id", "whatsapp_connections", ["dealership_id"])
    op.create_index("ix_whatsapp_connections_status", "whatsapp_connections", ["status"])


def downgrade() -> None:
    # Drop whatsapp_connections
    op.drop_index("ix_whatsapp_connections_status", table_name="whatsapp_connections")
    op.drop_index("ix_whatsapp_connections_dealership_id", table_name="whatsapp_connections")
    op.drop_table("whatsapp_connections")

    # Drop whatsapp_bulk_sends
    op.drop_index("ix_whatsapp_bulk_sends_created_at", table_name="whatsapp_bulk_sends")
    op.drop_index("ix_whatsapp_bulk_sends_status", table_name="whatsapp_bulk_sends")
    op.drop_index("ix_whatsapp_bulk_sends_dealership_id", table_name="whatsapp_bulk_sends")
    op.drop_index("ix_whatsapp_bulk_sends_user_id", table_name="whatsapp_bulk_sends")
    op.drop_table("whatsapp_bulk_sends")

    # Drop whatsapp_messages
    op.drop_index("ix_whatsapp_messages_created_at", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_is_read", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_bulk_send_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_status", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_direction", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_phone_number", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_wa_message_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_dealership_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_user_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_lead_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_customer_id", table_name="whatsapp_messages")
    op.drop_table("whatsapp_messages")

    # Drop channel enum
    op.execute("DROP TYPE IF EXISTS whatsappchannel")
