"""
Promote a user to dealership admin for a specific dealership.

Usage (from backend directory):
    python -m scripts.promote_user_to_admin <email> [dealership_name]

Example:
    python -m scripts.promote_user_to_admin Miguelriveranova247@gmail.com "Toyota South Atlanta"
"""
import asyncio
import sys

from sqlalchemy import func, select

from app.core.permissions import UserRole
from app.db.database import async_session_maker
from app.models.dealership import Dealership
from app.models.user import User


async def promote(email: str, dealership_name: str) -> bool:
    async with async_session_maker() as session:
        r = await session.execute(
            select(Dealership).where(Dealership.name.ilike(f"%{dealership_name}%"))
        )
        dealership = r.scalar_one_or_none()
        if not dealership:
            print(f"Dealership matching '{dealership_name}' not found.")
            return False

        r = await session.execute(
            select(User).where(
                func.lower(User.email) == email.strip().lower(),
                User.dealership_id == dealership.id,
            )
        )
        user = r.scalar_one_or_none()
        if not user:
            print(f"No user '{email}' found at {dealership.name}.")
            return False

        previous_role = user.role
        user.role = UserRole.DEALERSHIP_ADMIN
        user.is_active = True
        await session.commit()

        print(
            f"Updated {user.email} at {dealership.name}: "
            f"{previous_role.value} -> {UserRole.DEALERSHIP_ADMIN.value}"
        )
        print(f"User ID: {user.id}")
        return True


def main():
    if len(sys.argv) < 2:
        print(
            'Usage: python -m scripts.promote_user_to_admin <email> [dealership_name]'
        )
        sys.exit(1)

    email = sys.argv[1]
    dealership_name = sys.argv[2] if len(sys.argv) > 2 else "Toyota South Atlanta"
    success = asyncio.run(promote(email, dealership_name))
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
