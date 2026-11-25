"""Note reminders: callbacks and deadlines the AI found in a lead's notes.

Revision ID: cc_note_reminders
Revises: cb_call_insight_questions
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "cc_note_reminders"
down_revision: Union[str, None] = "cb_call_insight_questions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "note_reminder_scans",
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notes_hash", sa.String(length=64), nullable=False),
        sa.Column("notes_considered", sa.Integer(), nullable=False),
        sa.Column("llm_model", sa.String(length=80), nullable=True),
        sa.Column("prompt_version", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "note_reminders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_activity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("time_given", sa.Boolean(), nullable=False),
        sa.Column("assignee_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("follow_up_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("llm_model", sa.String(length=80), nullable=True),
        sa.Column("prompt_version", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_activity_id"], ["activities.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assignee_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["follow_up_id"], ["follow_ups.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("lead_id", "source_activity_id", "due_at", name="uq_note_reminders_lead_note_due"),
    )
    op.create_index("ix_note_reminders_lead_id", "note_reminders", ["lead_id"])
    op.create_index("ix_note_reminders_dealership_id", "note_reminders", ["dealership_id"])
    op.create_index("ix_note_reminders_due_at", "note_reminders", ["due_at"])
    op.create_index("ix_note_reminders_assignee_user_id", "note_reminders", ["assignee_user_id"])
    op.create_index("ix_note_reminders_status", "note_reminders", ["status"])


def downgrade() -> None:
    op.drop_table("note_reminders")
    op.drop_table("note_reminder_scans")
