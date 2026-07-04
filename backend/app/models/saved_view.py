"""
SavedView Model - user-saved filter/column/sort configurations
for list screens (leads, appointments, customers, ...).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base
from app.core.timezone import utc_now


class SavedView(Base):
    """A named, reusable view: filters + visible columns + sort order."""

    __tablename__ = "saved_views"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Which list screen this view belongs to (e.g. "leads")
    entity_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="leads", index=True
    )

    # Arbitrary filter params matching the list endpoint's query params
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Ordered list of visible column keys; null = screen default
    columns: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # {"key": "created_at", "direction": "desc"}
    sort: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    def __repr__(self) -> str:
        return f"<SavedView {self.name} ({self.entity_type}) user={self.user_id}>"
