"""AI call reviews: rubrics, reviews (transcripts), evaluations.

Revision ID: bz_call_reviews
Revises: cd_bdc_attention_progress
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bz_call_reviews"
down_revision: Union[str, None] = "cd_bdc_attention_progress"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Kept inline (not imported from app code) so the migration stays stable
# even if the default rubric in the application changes later.
_DEFAULT_CRITERIA = [
    {
        "key": "opening_professionalism",
        "name": "Opening and professionalism",
        "weight": 10,
        "what_good_looks_like": "Greets the customer warmly, states own name and the dealership, confirms who they are speaking to, and stays courteous throughout.",
        "what_bad_looks_like": "No introduction, rushed or flat tone, interrupting or talking over the customer.",
    },
    {
        "key": "needs_discovery",
        "name": "Customer needs discovery",
        "weight": 20,
        "what_good_looks_like": "Asks open questions about the vehicle wanted, timeline, trade-in, budget or financing situation, and listens to the answers before pitching.",
        "what_bad_looks_like": "Pitches before understanding what the customer wants; asks no questions.",
    },
    {
        "key": "product_knowledge",
        "name": "Product knowledge and helpfulness",
        "weight": 10,
        "what_good_looks_like": "Answers questions accurately and clearly, or commits to finding the answer; offers relevant options.",
        "what_bad_looks_like": "Vague, evasive or incorrect answers; leaves customer questions unanswered.",
    },
    {
        "key": "objection_handling",
        "name": "Objection handling",
        "weight": 20,
        "what_good_looks_like": "Acknowledges the concern, asks a clarifying question, responds to the real concern, and then moves the conversation forward.",
        "what_bad_looks_like": "Ignores the objection, argues, or gives up at the first sign of resistance.",
    },
    {
        "key": "appointment_attempt",
        "name": "Appointment-setting attempt",
        "weight": 25,
        "what_good_looks_like": "Clearly asks for a visit, offers specific days and times, and asks again after handling an objection.",
        "what_bad_looks_like": "Never asks for the appointment, or asks vaguely ('come by whenever') without a specific time.",
    },
    {
        "key": "follow_up_next_steps",
        "name": "Follow-up and next steps",
        "weight": 15,
        "what_good_looks_like": "Ends with a clear, agreed next step: confirmed appointment time, a scheduled callback, or what will be sent and when.",
        "what_bad_looks_like": "Call ends with no agreed next step.",
    },
]


def upgrade() -> None:
    rubrics = op.create_table(
        "call_rubrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("criteria", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("guidance", sa.Text(), nullable=True),
        sa.Column("change_note", sa.String(length=500), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["published_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("version", name="uq_call_rubrics_version"),
    )
    op.create_index("ix_call_rubrics_status", "call_rubrics", ["status"])

    op.create_table(
        "call_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("call_log_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rep_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("skip_reason", sa.String(length=100), nullable=True),
        sa.Column("transcript", postgresql.JSONB(), nullable=True),
        sa.Column("transcript_provider", sa.String(length=50), nullable=True),
        sa.Column("transcript_model", sa.String(length=100), nullable=True),
        sa.Column("transcribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("call_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["call_log_id"], ["call_logs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rep_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("call_log_id", name="uq_call_reviews_call_log_id"),
    )
    op.create_index("ix_call_reviews_lead_id", "call_reviews", ["lead_id"])
    op.create_index("ix_call_reviews_rep_user_id", "call_reviews", ["rep_user_id"])
    op.create_index("ix_call_reviews_dealership_id", "call_reviews", ["dealership_id"])
    op.create_index("ix_call_reviews_status", "call_reviews", ["status"])
    op.create_index("ix_call_reviews_call_started_at", "call_reviews", ["call_started_at"])

    op.create_table(
        "call_evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("review_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("rubric_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rubric_version", sa.Integer(), nullable=True),
        sa.Column("llm_model", sa.String(length=100), nullable=False),
        sa.Column("prompt_version", sa.String(length=20), nullable=False),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column("category_scores", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("result", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("ai_call_outcome", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["call_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rubric_id"], ["call_rubrics.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_call_evaluations_review_id", "call_evaluations", ["review_id"])
    op.create_index("ix_call_evaluations_is_current", "call_evaluations", ["is_current"])
    op.create_index("ix_call_evaluations_rubric_version", "call_evaluations", ["rubric_version"])

    # Seed version 1 so scoring works out of the box; managers tune it from Settings.
    now = datetime.now(timezone.utc)
    op.bulk_insert(
        rubrics,
        [
            {
                "id": uuid.uuid4(),
                "version": 1,
                "status": "active",
                "name": "Call scoring rubric",
                "criteria": json.loads(json.dumps(_DEFAULT_CRITERIA)),
                "guidance": None,
                "change_note": "Initial rubric",
                "published_at": now,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("call_evaluations")
    op.drop_table("call_reviews")
    op.drop_table("call_rubrics")
