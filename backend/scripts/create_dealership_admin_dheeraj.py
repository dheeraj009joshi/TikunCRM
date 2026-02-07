"""
One-off script: Create dealership admin dheeraj@tikuntech.com for Toyota South Atlanta.

Usage (from backend directory):
    python -m scripts.create_dealership_admin_dheeraj
"""
import asyncio
from uuid import uuid4
from datetime import datetime, timezone

from sqlalchemy import select
from app.db.database import async_session_maker
from app.core.security import get_password_hash
from app.core.permissions import UserRole
from app.models.user import User
from app.models.dealership import Dealership


EMAIL = "dheeraj@tikuntech.com"
PASSWORD = "12345678"
DEALERSHIP_NAME = "Toyota South Atlanta"  # partial match with ilike


async def main():
    async with async_session_maker() as session:
        # Find Toyota South Atlanta
        r = await session.execute(
            select(Dealership).where(Dealership.name.ilike(f"%{DEALERSHIP_NAME}%"))
        )
        dealership = r.scalar_one_or_none()
        if not dealership:
            print(f"Dealership matching '{DEALERSHIP_NAME}' not found.")
            return

        # Find existing user
        r = await session.execute(select(User).where(User.email == EMAIL))
        user = r.scalar_one_or_none()

        if user:
            user.password_hash = get_password_hash(PASSWORD)
            user.role = UserRole.DEALERSHIP_ADMIN
            user.dealership_id = dealership.id
            user.is_active = True
            user.must_change_password = False
            print(f"Updated existing user {EMAIL} -> Dealership Admin @ {dealership.name}")
        else:
            user = User(
                id=uuid4(),
                email=EMAIL,
                password_hash=get_password_hash(PASSWORD),
                first_name="Dheeraj",
                last_name="Tikun",
                role=UserRole.DEALERSHIP_ADMIN,
                dealership_id=dealership.id,
                is_active=True,
                is_verified=True,
                must_change_password=False,
            )
            session.add(user)
            print(f"Created user {EMAIL} -> Dealership Admin @ {dealership.name}")

        await session.commit()
        print(f"\nLogin: {EMAIL} / {PASSWORD}")
        print(f"Dealership: {dealership.name} (id={dealership.id})")


if __name__ == "__main__":
    asyncio.run(main())
