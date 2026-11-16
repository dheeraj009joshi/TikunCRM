"""
Call review models — AI call feedback.

CallRubric      Versioned scoring criteria, editable by managers in Settings.
CallReview      One per reviewed call: processing status + transcript.
CallEvaluation  One AI evaluation of a review against one rubric version.
                Several may exist per review (e.g. after a re-score); the newest
                with is_current=True is the one shown.

AI call *quality* (CallEvaluation) is deliberately stored apart from the actual
CRM *outcome* (appointments, showroom visits) so the two are never confused.
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timezone import utc_now
from app.db.database import Base

if TYPE_CHECKING:
    from app.models.call_log import CallLog
    from app.models.user import User


class RubricStatus(str, Enum):
    DRAFT = "draft"          # Being edited; not used for scoring
    ACTIVE = "active"        # The one version used for new evaluations
    ARCHIVED = "archived"    # Previously active; kept for audit


class CallReviewStatus(str, Enum):
    PENDING = "pending"
    TRANSCRIBING = "transcribing"
    EVALUATING = "evaluating"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"      # Not eligible (too short, voicemail, no speech...)


class CallRubric(Base):
    """
    A version of the scoring rubric. Published versions are immutable; editing
    happens on a single draft row which receives the next version number when
    published.
    """

    __tablename__ = "call_rubrics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Null while draft; assigned (1, 2, 3...) on publish
    version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=RubricStatus.DRAFT.value, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="Call scoring rubric")
    # [{key, name, weight, what_good_looks_like, what_bad_looks_like}]
    criteria: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Free-text guidance applied to every call (e.g. "never quote price by phone")
    guidance: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    change_note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class CallReview(Base):
    """Processing record + transcript for one call."""

    __tablename__ = "call_reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    call_log_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("call_logs.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # Denormalised from the call so list/scoping queries don't need joins
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    rep_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dealerships.id", ondelete="SET NULL"), nullable=True, index=True
    )

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=CallReviewStatus.PENDING.value, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Short, non-sensitive reason (never transcript text)
    error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    skip_reason: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Transcript: [{speaker: "rep"|"customer", start: float, end: float, text: str}]
    transcript: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    transcript_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    transcript_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    transcribed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    call_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Manager sign-off: a person has looked at this AI review
    manager_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    manager_reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    manager_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    call_log: Mapped["CallLog"] = relationship("CallLog", lazy="noload")
    rep: Mapped[Optional["User"]] = relationship("User", lazy="noload", foreign_keys=[rep_user_id])
    evaluations: Mapped[list["CallEvaluation"]] = relationship(
        "CallEvaluation", back_populates="review", lazy="noload", cascade="all, delete-orphan"
    )


class CallEvaluation(Base):
    """One AI evaluation of a call against one rubric version."""

    __tablename__ = "call_evaluations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("call_reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    # Audit trail: exactly what produced this score
    rubric_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("call_rubrics.id", ondelete="SET NULL"), nullable=True
    )
    rubric_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    llm_model: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)

    # Weighted score 0-100, computed in code from category scores (not by the LLM)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Overall score after manager corrections to category scores (null = no corrections).
    # The AI's own score above is never overwritten.
    adjusted_overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # [{key, name, weight, score, not_applicable, rationale, evidence:[...]}]
    category_scores: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Full validated result: summary, strengths, improvements, objections, etc.
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # What the AI heard happen on the call — NOT the CRM outcome
    ai_call_outcome: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    review: Mapped["CallReview"] = relationship("CallReview", back_populates="evaluations", lazy="noload")


class FeedbackItemType(str, Enum):
    CATEGORY = "category"                    # item_key = rubric criterion key
    STRENGTH = "strength"                    # item_key = index in the evaluation's list
    IMPROVEMENT = "improvement"
    MISSED_OPPORTUNITY = "missed_opportunity"
    OBJECTION = "objection"
    COACHING = "coaching"


class FeedbackVerdict(str, Enum):
    ACCURATE = "accurate"
    INACCURATE = "inaccurate"    # manager says the AI got this wrong
    USEFUL = "useful"            # coaching suggestion worth using
    NOT_USEFUL = "not_useful"


class CallEvaluationFeedback(Base):
    """
    A manager's verdict on one item of an AI evaluation. Evaluations are
    immutable, so items are addressed by their position in the stored result.
    """

    __tablename__ = "call_evaluation_feedback"
    __table_args__ = (
        UniqueConstraint("evaluation_id", "item_type", "item_key", name="uq_call_eval_feedback_item"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    evaluation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("call_evaluations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("call_reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_type: Mapped[str] = mapped_column(String(30), nullable=False)
    item_key: Mapped[str] = mapped_column(String(80), nullable=False)
    verdict: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Only for item_type=category: the score the manager says it should be (0-100)
    corrected_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class CallInsightQuestion(Base):
    """
    Audit record of a plain-English question a manager asked about calls and
    the answer that was shown, with the model and prompt version that produced it.
    """

    __tablename__ = "call_insight_questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asked_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    # {days, rep_user_id, dealership_id}
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # {answerable, answer, caveats, supporting_calls, unverified_figures}
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    calls_considered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    llm_model: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
