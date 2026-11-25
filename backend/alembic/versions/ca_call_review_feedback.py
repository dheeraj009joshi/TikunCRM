"""AI call reviews: manager feedback, sign-off and corrected scores.

Revision ID: ca_call_review_feedback
Revises: bz_call_reviews
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ca_call_review_feedback"
down_revision: Union[str, None] = "bz_call_reviews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("call_reviews", sa.Column("manager_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("call_reviews", sa.Column("manager_reviewed_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("call_reviews", sa.Column("manager_note", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_call_reviews_manager_reviewed_by", "call_reviews", "users", ["manager_reviewed_by"], ["id"],
        ondelete="SET NULL",
    )
    op.add_column("call_evaluations", sa.Column("adjusted_overall_score", sa.Float(), nullable=True))

    op.create_table(
        "call_evaluation_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("evaluation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("review_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_type", sa.String(length=30), nullable=False),
        sa.Column("item_key", sa.String(length=80), nullable=False),
        sa.Column("verdict", sa.String(length=20), nullable=True),
        sa.Column("corrected_score", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["evaluation_id"], ["call_evaluations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["review_id"], ["call_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("evaluation_id", "item_type", "item_key", name="uq_call_eval_feedback_item"),
    )
    op.create_index("ix_call_evaluation_feedback_evaluation_id", "call_evaluation_feedback", ["evaluation_id"])
    op.create_index("ix_call_evaluation_feedback_review_id", "call_evaluation_feedback", ["review_id"])


def downgrade() -> None:
    op.drop_table("call_evaluation_feedback")
    op.drop_column("call_evaluations", "adjusted_overall_score")
    op.drop_constraint("fk_call_reviews_manager_reviewed_by", "call_reviews", type_="foreignkey")
    op.drop_column("call_reviews", "manager_note")
    op.drop_column("call_reviews", "manager_reviewed_by")
    op.drop_column("call_reviews", "manager_reviewed_at")
