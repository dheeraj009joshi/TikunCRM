"""
Script to change a user's password.

Usage (from backend directory):
    python -m scripts.change_user_password <email> <new_password>

Example:
    python -m scripts.change_user_password amojica@toyotasouthatlanta.com "Atlanta123."
"""

import asyncio
import sys
from sqlalchemy import select
from app.db.database import async_session_maker
from app.models.user import User
from app.core.security import get_password_hash


async def change_password(email: str, new_password: str):
    """Change password for a user by email."""
    async with async_session_maker() as session:
        # Find the user by email
        result = await session.execute(
            select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            print(f"Error: User with email '{email}' not found.")
            return False
        
        # Generate new password hash
        new_hash = get_password_hash(new_password)
        
        # Update the password
        user.password_hash = new_hash
        await session.commit()
        
        print(f"Password updated successfully for user: {email}")
        print(f"User ID: {user.id}")
        print(f"Name: {user.first_name} {user.last_name}")
        return True


def main():
    if len(sys.argv) != 3:
        print("Usage: python -m scripts.change_user_password <email> <new_password>")
        print('Example: python -m scripts.change_user_password user@example.com "MyNewPass123!"')
        sys.exit(1)
    
    email = sys.argv[1]
    new_password = sys.argv[2]
    
    success = asyncio.run(change_password(email, new_password))
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
