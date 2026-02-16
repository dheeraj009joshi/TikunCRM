"""
Background task for syncing emails from IMAP
Runs periodically to fetch new incoming emails for all users
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.database import get_engine_url_and_connect_args
from app.models.user import User
from app.services.user_imap_service import sync_all_user_inboxes

logger = logging.getLogger(__name__)


class EmailSyncTask:
    """
    Background task that periodically syncs emails from IMAP for all users.
    Each user has their own Hostinger email credentials configured.
    """
    
    def __init__(self):
        self._engine = None
        self._session_factory = None
    
    def _get_session_factory(self):
        """Create async session factory."""
        if self._engine is None:
            from sqlalchemy.pool import NullPool
            url, connect_args = get_engine_url_and_connect_args()
            self._engine = create_async_engine(
                url,
                echo=False,
                poolclass=NullPool,  # Use NullPool for background tasks
                connect_args=connect_args,
            )
            self._session_factory = sessionmaker(
                self._engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )
        return self._session_factory
    
    async def sync_all_users(self) -> dict:
        """
        Sync emails for all users with email configured.
        
        Returns:
            Dict with sync statistics
        """
        logger.info("Starting email sync for all users...")
        
        session_factory = self._get_session_factory()
        
        async with session_factory() as db:
            try:
                stats = await sync_all_user_inboxes(db)
                
                total_fetched = sum(s.get("emails_fetched", 0) for s in stats)
                total_matched = sum(s.get("emails_matched", 0) for s in stats)
                total_errors = sum(len(s.get("errors", [])) for s in stats)
                
                summary = {
                    "users_synced": len(stats),
                    "total_emails_fetched": total_fetched,
                    "total_emails_matched": total_matched,
                    "total_errors": total_errors,
                }
                
                logger.info(f"Email sync completed: {summary}")
                return summary
                
            except Exception as e:
                logger.error(f"Error during email sync: {e}")
                return {
                    "users_synced": 0,
                    "total_emails_fetched": 0,
                    "total_emails_matched": 0,
                    "total_errors": 1,
                    "error": str(e)
                }


# Singleton instance
email_sync_task = EmailSyncTask()


async def run_email_sync():
    """Entry point for the background scheduler."""
    return await email_sync_task.sync_all_users()
