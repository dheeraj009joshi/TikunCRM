"""Add Auto WhatsApp tables for Selenium-based bulk messaging

Revision ID: au_auto_whatsapp
Revises: at_add_leadsource_inbound
Create Date: 2026-05-10

Adds three new tables for the Auto WhatsApp feature:
- auto_whatsapp_profiles: Per-dealership WhatsApp Web session profiles
- auto_whatsapp_jobs: Bulk send job tracking
- auto_whatsapp_job_logs: Job activity logs
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "au_auto_whatsapp"
down_revision: Union[str, None] = "at_add_leadsource_inbound"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create auto_whatsapp_profiles table
    op.create_table(
        "auto_whatsapp_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "dealership_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealerships.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("phone_number", sa.String(20), nullable=True),
        sa.Column("profile_path", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, default="disconnected"),
        sa.Column("last_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_auto_whatsapp_profiles_dealership_id",
        "auto_whatsapp_profiles",
        ["dealership_id"],
    )

    # Create auto_whatsapp_jobs table
    op.create_table(
        "auto_whatsapp_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "dealership_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealerships.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auto_whatsapp_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("message_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, default="pending"),
        sa.Column("total_leads", sa.Integer(), nullable=False, default=0),
        sa.Column("sent_count", sa.Integer(), nullable=False, default=0),
        sa.Column("failed_count", sa.Integer(), nullable=False, default=0),
        sa.Column("current_index", sa.Integer(), nullable=False, default=0),
        sa.Column(
            "lead_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "filter_criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "errors",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_auto_whatsapp_jobs_dealership_id",
        "auto_whatsapp_jobs",
        ["dealership_id"],
    )
    op.create_index(
        "ix_auto_whatsapp_jobs_profile_id",
        "auto_whatsapp_jobs",
        ["profile_id"],
    )
    op.create_index(
        "ix_auto_whatsapp_jobs_created_by",
        "auto_whatsapp_jobs",
        ["created_by"],
    )
    op.create_index(
        "ix_auto_whatsapp_jobs_status",
        "auto_whatsapp_jobs",
        ["status"],
    )
    op.create_index(
        "ix_auto_whatsapp_jobs_created_at",
        "auto_whatsapp_jobs",
        ["created_at"],
    )

    # Create auto_whatsapp_job_logs table
    op.create_table(
        "auto_whatsapp_job_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auto_whatsapp_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "meta_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_auto_whatsapp_job_logs_job_id",
        "auto_whatsapp_job_logs",
        ["job_id"],
    )
    op.create_index(
        "ix_auto_whatsapp_job_logs_created_at",
        "auto_whatsapp_job_logs",
        ["created_at"],
    )


def downgrade() -> None:
    # Drop tables in reverse order (respecting foreign keys)
    op.drop_index("ix_auto_whatsapp_job_logs_created_at", table_name="auto_whatsapp_job_logs")
    op.drop_index("ix_auto_whatsapp_job_logs_job_id", table_name="auto_whatsapp_job_logs")
    op.drop_table("auto_whatsapp_job_logs")

    op.drop_index("ix_auto_whatsapp_jobs_created_at", table_name="auto_whatsapp_jobs")
    op.drop_index("ix_auto_whatsapp_jobs_status", table_name="auto_whatsapp_jobs")
    op.drop_index("ix_auto_whatsapp_jobs_created_by", table_name="auto_whatsapp_jobs")
    op.drop_index("ix_auto_whatsapp_jobs_profile_id", table_name="auto_whatsapp_jobs")
    op.drop_index("ix_auto_whatsapp_jobs_dealership_id", table_name="auto_whatsapp_jobs")
    op.drop_table("auto_whatsapp_jobs")

    op.drop_index("ix_auto_whatsapp_profiles_dealership_id", table_name="auto_whatsapp_profiles")
    op.drop_table("auto_whatsapp_profiles")
