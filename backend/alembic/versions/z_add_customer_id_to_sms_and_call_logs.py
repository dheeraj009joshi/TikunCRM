"""Add customer_id to sms_logs and call_logs for customer-level conversations

Revision ID: z_customer_sms_call
Revises: y_lead_updated_activity
Create Date: 2026-02-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "z_customer_sms_call"
down_revision = "y_lead_updated_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add customer_id to sms_logs
    op.add_column(
        "sms_logs",
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_sms_logs_customer_id",
        "sms_logs",
        "customers",
        ["customer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_sms_logs_customer_id", "sms_logs", ["customer_id"])

    # Backfill sms_logs.customer_id from lead's customer_id
    op.execute("""
        UPDATE sms_logs
        SET customer_id = leads.customer_id
        FROM leads
        WHERE sms_logs.lead_id = leads.id
        AND sms_logs.customer_id IS NULL
    """)

    # Add customer_id to call_logs
    op.add_column(
        "call_logs",
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_call_logs_customer_id",
        "call_logs",
        "customers",
        ["customer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_call_logs_customer_id", "call_logs", ["customer_id"])

    # Backfill call_logs.customer_id from lead's customer_id
    op.execute("""
        UPDATE call_logs
        SET customer_id = leads.customer_id
        FROM leads
        WHERE call_logs.lead_id = leads.id
        AND call_logs.customer_id IS NULL
    """)


def downgrade() -> None:
    op.drop_index("ix_call_logs_customer_id", table_name="call_logs")
    op.drop_constraint("fk_call_logs_customer_id", "call_logs", type_="foreignkey")
    op.drop_column("call_logs", "customer_id")

    op.drop_index("ix_sms_logs_customer_id", table_name="sms_logs")
    op.drop_constraint("fk_sms_logs_customer_id", "sms_logs", type_="foreignkey")
    op.drop_column("sms_logs", "customer_id")
