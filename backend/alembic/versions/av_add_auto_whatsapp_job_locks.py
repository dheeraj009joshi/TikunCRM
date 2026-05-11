"""Add lock fields to Auto WhatsApp jobs table

Revision ID: av_job_locks
Revises: au_auto_whatsapp
Create Date: 2026-05-11

Adds locked_at and locked_by fields to prevent duplicate job processing
when running multiple server workers.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "av_job_locks"
down_revision: Union[str, None] = "au_auto_whatsapp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add lock fields to auto_whatsapp_jobs table
    op.add_column(
        "auto_whatsapp_jobs",
        sa.Column(
            "locked_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Timestamp when job was locked for processing"
        )
    )
    op.add_column(
        "auto_whatsapp_jobs",
        sa.Column(
            "locked_by",
            sa.String(100),
            nullable=True,
            comment="Worker identifier (hostname:pid) that locked the job"
        )
    )
    
    # Add index for efficient lock queries
    op.create_index(
        "ix_auto_whatsapp_jobs_locked_at",
        "auto_whatsapp_jobs",
        ["locked_at"],
        unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_auto_whatsapp_jobs_locked_at", table_name="auto_whatsapp_jobs")
    op.drop_column("auto_whatsapp_jobs", "locked_by")
    op.drop_column("auto_whatsapp_jobs", "locked_at")
