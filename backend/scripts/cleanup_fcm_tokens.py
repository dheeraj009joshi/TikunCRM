"""
Script to delete all FCM tokens from the database.
Run this to clean up stale tokens and start fresh.

Usage:
    python scripts/cleanup_fcm_tokens.py
"""
import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import engine


async def cleanup_fcm_tokens():
    """Delete all FCM tokens from the database."""
    async with engine.begin() as conn:
        # Count existing tokens
        result = await conn.execute(text("SELECT COUNT(*) FROM fcm_tokens"))
        count = result.scalar()
        print(f"Found {count} FCM tokens in database")
        
        if count > 0:
            # Delete all tokens
            await conn.execute(text("DELETE FROM fcm_tokens"))
            print(f"Deleted {count} FCM tokens")
        else:
            print("No tokens to delete")
        
        print("FCM token cleanup complete!")


if __name__ == "__main__":
    asyncio.run(cleanup_fcm_tokens())
