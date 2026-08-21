"""
Softphone presence — which users currently have a live Twilio Device registered.

Twilio cannot list registered Client identities, so the browser heartbeats
here on register / idle / busy / unregister. Inbound Dial uses only live rows.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import Boolean, DateTime, ForeignKey, select
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timezone import utc_now
from app.db.database import Base

logger = logging.getLogger(__name__)

# Frontend should heartbeat more often than this window.
PRESENCE_TTL = timedelta(seconds=45)


class SoftphonePresence(Base):
    __tablename__ = "softphone_presence"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    is_busy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )


async def upsert_presence(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    busy: Optional[bool] = None,
) -> SoftphonePresence:
    row = await db.get(SoftphonePresence, user_id)
    if row is None:
        row = SoftphonePresence(user_id=user_id, is_busy=bool(busy) if busy is not None else False)
        db.add(row)
    elif busy is not None:
        row.is_busy = bool(busy)
    row.last_seen_at = utc_now()
    await db.flush()
    return row


async def clear_presence(db: AsyncSession, user_id: uuid.UUID) -> None:
    row = await db.get(SoftphonePresence, user_id)
    if row:
        await db.delete(row)
        await db.flush()


async def live_user_ids(
    db: AsyncSession,
    user_ids: Iterable[uuid.UUID],
    *,
    exclude_busy: bool = True,
) -> Set[uuid.UUID]:
    ids = list({u for u in user_ids if u})
    if not ids:
        return set()
    cutoff = utc_now() - PRESENCE_TTL
    q = await db.execute(
        select(SoftphonePresence).where(
            SoftphonePresence.user_id.in_(ids),
            SoftphonePresence.last_seen_at >= cutoff,
        )
    )
    live: Set[uuid.UUID] = set()
    for row in q.scalars().all():
        if exclude_busy and row.is_busy:
            continue
        live.add(row.user_id)
    return live


async def presence_snapshot(
    db: AsyncSession,
    user_ids: Iterable[uuid.UUID],
) -> Dict[str, dict]:
    ids = list({u for u in user_ids if u})
    if not ids:
        return {}
    cutoff = utc_now() - PRESENCE_TTL
    q = await db.execute(
        select(SoftphonePresence).where(SoftphonePresence.user_id.in_(ids))
    )
    out: Dict[str, dict] = {}
    for row in q.scalars().all():
        is_live = row.last_seen_at >= cutoff
        out[str(row.user_id)] = {
            "live": is_live,
            "busy": row.is_busy,
            "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        }
    return out
