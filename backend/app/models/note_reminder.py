"""
Note reminders: callbacks and deadlines the AI found in a lead's notes.

A suggestion is never a follow-up by itself. The rep (or a manager) accepts it,
which creates an ordinary FollowUp, or dismisses it. Every suggestion keeps the
exact words from the note it came from, plus the model and prompt version.
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now
from app.db.database import Base


class NoteReminderStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"
    # A later read of the notes no longer found it (e.g. a newer note says it's done)
    SUPERSEDED = "superseded"


class NoteReminderScan(Base):
    """The last time a lead's notes were read, so unchanged notes are not re-read."""

    __tablename__ = "note_reminder_scans"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True
    )
    notes_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    notes_considered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    llm_model: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class NoteReminder(Base):
    __tablename__ = "note_reminders"
    __table_args__ = (
        UniqueConstraint("lead_id", "source_activity_id", "due_at", name="uq_note_reminders_lead_note_due"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dealerships.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # The note (activity) the reminder was read from
    source_activity_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    # Exact words from the note (phone numbers and emails removed)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    # False when the note gave a day but no time, so the default time was used
    time_given: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    assignee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=NoteReminderStatus.PENDING.value, index=True
    )
    follow_up_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("follow_ups.id", ondelete="SET NULL"), nullable=True
    )
    decided_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    llm_model: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
