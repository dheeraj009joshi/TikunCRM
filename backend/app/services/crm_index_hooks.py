"""
SQLAlchemy hooks to queue CRM content indexing after commit.
"""
from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_SESSION_KEY = "crm_index_activity_ids"


def mark_activity_for_index(session: Session, activity_id: UUID) -> None:
    pending = session.info.setdefault(_SESSION_KEY, set())
    pending.add(str(activity_id))


@event.listens_for(Session, "after_commit")
def _flush_crm_index_queue(session: Session) -> None:
    ids = session.info.pop(_SESSION_KEY, None)
    if not ids:
        return
    from app.tasks.crm_search_index import queue_activity_index

    for aid in ids:
        try:
            queue_activity_index(UUID(aid))
        except Exception:
            logger.exception("Failed to queue CRM index for activity %s", aid)
