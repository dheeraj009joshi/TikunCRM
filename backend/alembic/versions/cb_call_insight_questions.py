"""AI call reviews: audit log of plain-English questions asked about calls.

Revision ID: cb_call_insight_questions
Revises: ca_call_review_feedback
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cb_call_insight_questions"
down_revision: Union[str, None] = "ca_call_review_feedback"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "call_insight_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("asked_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("filters", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("calls_considered", sa.Integer(), nullable=False),
        sa.Column("llm_model", sa.String(length=80), nullable=True),
        sa.Column("prompt_version", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["asked_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_call_insight_questions_asked_by", "call_insight_questions", ["asked_by"])
    op.create_index("ix_call_insight_questions_created_at", "call_insight_questions", ["created_at"])


def downgrade() -> None:
    op.drop_table("call_insight_questions")
