"""
Auto WhatsApp Models - Selenium-based WhatsApp Web automation for bulk messaging.

This is a standalone feature separate from Twilio-based WhatsApp integration.
It uses browser automation to send messages via WhatsApp Web with per-dealership
Chrome profiles.
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.dealership import Dealership
    from app.models.user import User


class AutoWhatsAppProfileStatus(str, Enum):
    """Status of a WhatsApp Web profile connection"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    QR_READY = "qr_ready"
    ERROR = "error"


class AutoWhatsAppJobStatus(str, Enum):
    """Status of a bulk WhatsApp send job"""
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class AutoWhatsAppLogAction(str, Enum):
    """Action types for job activity logs"""
    CREATED = "created"
    STARTED = "started"
    PAUSED = "paused"
    RESUMED = "resumed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"
    ERROR = "error"


class AutoWhatsAppProfile(Base):
    """
    Stores WhatsApp Web session profile for each dealership.
    Each dealership has its own Chrome profile directory to maintain
    separate WhatsApp Web sessions.
    """
    __tablename__ = "auto_whatsapp_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    dealership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )
    phone_number: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        comment="WhatsApp phone number linked to this profile"
    )
    profile_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="Path to Chrome profile directory"
    )
    status: Mapped[AutoWhatsAppProfileStatus] = mapped_column(
        String(20),
        nullable=False,
        default=AutoWhatsAppProfileStatus.DISCONNECTED
    )
    last_connected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    dealership: Mapped["Dealership"] = relationship(
        "Dealership",
        lazy="selectin"
    )
    jobs: Mapped[List["AutoWhatsAppJob"]] = relationship(
        "AutoWhatsAppJob",
        back_populates="profile",
        lazy="noload"
    )

    def __repr__(self) -> str:
        return f"<AutoWhatsAppProfile dealership_id={self.dealership_id} status={self.status}>"


class AutoWhatsAppJob(Base):
    """
    Tracks a bulk WhatsApp message sending job.
    Stores the list of leads, message template, and progress information.
    """
    __tablename__ = "auto_whatsapp_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    dealership_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auto_whatsapp_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Job name/description"
    )
    message_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="Message template with placeholders like {{first_name}}"
    )
    status: Mapped[AutoWhatsAppJobStatus] = mapped_column(
        String(20),
        nullable=False,
        default=AutoWhatsAppJobStatus.PENDING,
        index=True
    )
    total_leads: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    sent_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    failed_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )
    current_index: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Current position in lead_ids for pause/resume"
    )
    lead_ids: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="Array of lead UUIDs in processing order"
    )
    filter_criteria: Mapped[dict] = mapped_column(
        JSONB,
        nullable=True,
        default=dict,
        comment="Original filters used to select leads"
    )
    errors: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="Array of {lead_id, phone, error, timestamp} for failed sends"
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    paused_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    locked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        comment="Timestamp when job was locked for processing"
    )
    locked_by: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Worker identifier (hostname:pid) that locked the job"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    dealership: Mapped["Dealership"] = relationship(
        "Dealership",
        lazy="selectin"
    )
    profile: Mapped[Optional["AutoWhatsAppProfile"]] = relationship(
        "AutoWhatsAppProfile",
        back_populates="jobs",
        lazy="selectin"
    )
    created_by_user: Mapped[Optional["User"]] = relationship(
        "User",
        lazy="selectin"
    )
    logs: Mapped[List["AutoWhatsAppJobLog"]] = relationship(
        "AutoWhatsAppJobLog",
        back_populates="job",
        lazy="noload",
        order_by="AutoWhatsAppJobLog.created_at"
    )

    @property
    def progress_percent(self) -> float:
        """Calculate progress percentage"""
        if self.total_leads == 0:
            return 0.0
        return round((self.sent_count + self.failed_count) / self.total_leads * 100, 1)

    @property
    def remaining_count(self) -> int:
        """Calculate remaining leads to process"""
        return self.total_leads - self.sent_count - self.failed_count

    def __repr__(self) -> str:
        return f"<AutoWhatsAppJob {self.name} status={self.status} progress={self.progress_percent}%>"


class AutoWhatsAppJobLog(Base):
    """
    Activity log for job state changes and significant events.
    One log record per action (not per message).
    """
    __tablename__ = "auto_whatsapp_job_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auto_whatsapp_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    action: Mapped[AutoWhatsAppLogAction] = mapped_column(
        String(20),
        nullable=False
    )
    message: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )
    meta_data: Mapped[dict] = mapped_column(
        JSONB,
        nullable=True,
        default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True
    )

    # Relationships
    job: Mapped["AutoWhatsAppJob"] = relationship(
        "AutoWhatsAppJob",
        back_populates="logs"
    )

    def __repr__(self) -> str:
        return f"<AutoWhatsAppJobLog {self.action} job_id={self.job_id}>"
