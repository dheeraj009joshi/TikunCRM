"""
Database Cleanup Script - Delete all data except Super Admin

Keeps only the Super Admin user (brown@tikuntech.com / admin123).
Removes all leads, activities, dealerships, users, etc.

Usage:
    cd backend && source venv/bin/activate
    python -m scripts.cleanup_database
"""

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user import User
from app.models.dealership import Dealership
from app.models.lead import Lead
from app.models.activity import Activity
from app.models.follow_up import FollowUp
from app.models.notification import Notification
from app.models.email_log import EmailLog
from app.models.email_template import EmailTemplate
from app.models.dealership_email_config import DealershipEmailConfig
from app.core.permissions import UserRole


SUPER_ADMIN_EMAIL = "brown@tikuntech.com"
SUPER_ADMIN_PASSWORD = "admin123"


async def cleanup_database():
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        print("=" * 50)
        print("DATABASE CLEANUP")
        print("=" * 50)
        print(f"\nConnecting to database...")
        print(f"Super Admin to keep: {SUPER_ADMIN_EMAIL}")
        print()

        # 1. Delete all activities
        print("[1/9] Deleting all activities...")
        await session.execute(delete(Activity))
        
        # 2. Delete all follow-ups
        print("[2/9] Deleting all follow-ups...")
        await session.execute(delete(FollowUp))
        
        # 3. Delete all notifications
        print("[3/9] Deleting all notifications...")
        await session.execute(delete(Notification))
        
        # 4. Delete all email logs
        print("[4/9] Deleting all email logs...")
        await session.execute(delete(EmailLog))
        
        # 5. Delete all email templates
        print("[5/9] Deleting all email templates...")
        await session.execute(delete(EmailTemplate))
        
        # 6. Delete all leads
        print("[6/9] Deleting all leads...")
        await session.execute(delete(Lead))
        
        # 7. Delete dealership email configs
        print("[7/9] Deleting all dealership email configs...")
        await session.execute(delete(DealershipEmailConfig))
        
        # 8. Delete all users except super admin
        print("[8/9] Deleting all users except super admin...")
        # First check if super admin exists
        result = await session.execute(
            select(User).where(User.email == SUPER_ADMIN_EMAIL)
        )
        super_admin = result.scalar_one_or_none()
        
        if super_admin:
            # Delete all users except this one
            await session.execute(
                delete(User).where(User.id != super_admin.id)
            )
            # Update super admin password and ensure correct role
            super_admin.password_hash = get_password_hash(SUPER_ADMIN_PASSWORD)
            super_admin.role = UserRole.SUPER_ADMIN
            super_admin.is_active = True
            super_admin.dealership_id = None
            super_admin.updated_at = datetime.now(timezone.utc)
            session.add(super_admin)
            print(f"       Updated: {SUPER_ADMIN_EMAIL} (password reset to {SUPER_ADMIN_PASSWORD})")
        else:
            # Delete all users
            await session.execute(delete(User))
            # Create super admin
            super_admin = User(
                id=uuid4(),
                email=SUPER_ADMIN_EMAIL,
                password_hash=get_password_hash(SUPER_ADMIN_PASSWORD),
                first_name="Brown",
                last_name="Admin",
                phone="+1 800 555 0000",
                role=UserRole.SUPER_ADMIN,
                dealership_id=None,
                is_active=True,
                is_verified=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(super_admin)
            print(f"       Created: {SUPER_ADMIN_EMAIL} (password: {SUPER_ADMIN_PASSWORD})")
        
        # 9. Delete all dealerships
        print("[9/9] Deleting all dealerships...")
        await session.execute(delete(Dealership))
        
        # Commit all changes
        await session.commit()
        
        print()
        print("=" * 50)
        print("CLEANUP COMPLETE!")
        print("=" * 50)
        print()
        print("All data has been removed.")
        print()
        print("Remaining:")
        print(f"  - Super Admin: {SUPER_ADMIN_EMAIL}")
        print(f"  - Password: {SUPER_ADMIN_PASSWORD}")
        print()
        print("Google Sheets sync interval: Every 1 minute")
        print("IMAP email sync interval: Every 1 minute")
        print()


if __name__ == "__main__":
    asyncio.run(cleanup_database())
