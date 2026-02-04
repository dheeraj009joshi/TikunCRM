"""
Timezone utilities for the backend.
All timestamps should be stored as timezone-aware UTC.
"""
from datetime import datetime, timezone


def utc_now() -> datetime:
    """
    Return current UTC time as timezone-aware datetime.
    
    This should be used instead of datetime.utcnow() which returns
    a naive datetime that can be misinterpreted by PostgreSQL.
    """
    return datetime.now(timezone.utc)
