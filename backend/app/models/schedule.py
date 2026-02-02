"""
Schedule Model - User Availability
"""
import uuid
from datetime import time
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class Schedule(Base):
    """User availability schedule"""
    
    __tablename__ = "schedules"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # 0 = Monday, 6 = Sunday
    day_of_week: Mapped[int] = mapped_column(
        Integer,
        nullable=False
    )
    
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    
    # Relationships - use lazy="noload" to avoid N+1 queries
    user: Mapped["User"] = relationship(
        "User",
        back_populates="schedules",
        lazy="noload"
    )
    
    def __repr__(self) -> str:
        return f"<Schedule {self.user_id} Day {self.day_of_week} {self.start_time}-{self.end_time}>"
