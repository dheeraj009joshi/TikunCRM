"""
Email Template Model
"""
import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.core.timezone import utc_now

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.dealership import Dealership


class TemplateCategory(str, Enum):
    """Email template categories"""
    FOLLOW_UP = "follow_up"
    INTRODUCTION = "introduction"
    QUOTE = "quote"
    THANK_YOU = "thank_you"
    APPOINTMENT = "appointment"
    CUSTOM = "custom"


class EmailTemplate(Base):
    """Reusable email templates"""
    
    __tablename__ = "email_templates"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    # Template metadata
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    
    category: Mapped[TemplateCategory] = mapped_column(
        SQLEnum(TemplateCategory),
        default=TemplateCategory.CUSTOM,
        nullable=False
    )
    
    # Template content
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=True)
    body_html: Mapped[str] = mapped_column(Text, nullable=True)
    
    # Variables available in template (for documentation)
    # e.g., ["{{lead_name}}", "{{dealership_name}}", "{{salesperson_name}}"]
    available_variables: Mapped[dict] = mapped_column(JSONB, default=list, nullable=False)
    
    # Ownership - can be system-wide, dealership-specific, or user-specific
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    dealership_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dealerships.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    
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
    dealership: Mapped[Optional["Dealership"]] = relationship(
        "Dealership",
        lazy="noload"
    )
    creator: Mapped[Optional["User"]] = relationship(
        "User",
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<EmailTemplate {self.name}>"
