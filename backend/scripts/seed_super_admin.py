"""
Seed Super Admin only – idempotent.

Creates or updates the Super Admin user (admin@leedscrm.com / admin123).
Use this against your production database if login fails or seed was never run.

Usage (from backend directory, with .env pointing to target DB):
    python -m scripts.seed_super_admin

Or with explicit DATABASE_URL:
    DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db?ssl=require" python -m scripts.seed_super_admin
"""

import asyncio
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user import User
from app.core.permissions import UserRole


SUPER_ADMIN_EMAIL = "admin@leedscrm.com"
SUPER_ADMIN_PASSWORD = "admin123"


async def seed_super_admin():
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        print(f"Using database from DATABASE_URL (host in URL)...")
        print(f"Super Admin email: {SUPER_ADMIN_EMAIL}")
        print()

        result = await session.execute(
            select(User).where(User.email == SUPER_ADMIN_EMAIL)
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.password_hash = get_password_hash(SUPER_ADMIN_PASSWORD)
            existing.is_active = True
            existing.updated_at = datetime.utcnow()
            session.add(existing)
            await session.commit()
            print(f"Updated existing Super Admin: {SUPER_ADMIN_EMAIL}")
            print(f"Password has been reset to: {SUPER_ADMIN_PASSWORD}")
        else:
            super_admin = User(
                id=uuid4(),
                email=SUPER_ADMIN_EMAIL,
                password_hash=get_password_hash(SUPER_ADMIN_PASSWORD),
                first_name="System",
                last_name="Administrator",
                phone="+1 800 555 0000",
                role=UserRole.SUPER_ADMIN,
                dealership_id=None,
                is_active=True,
                is_verified=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(super_admin)
            await session.commit()
            print(f"Created Super Admin: {SUPER_ADMIN_EMAIL}")
            print(f"Password: {SUPER_ADMIN_PASSWORD}")

        print()
        print("You can now log in with the credentials above.")


if __name__ == "__main__":
    asyncio.run(seed_super_admin())
