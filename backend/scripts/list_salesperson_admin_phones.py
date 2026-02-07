"""
List phone numbers (and email/name) of all salespersons and admins in the system.
Run from backend with venv: python -m scripts.list_salesperson_admin_phones
"""
import asyncio
import os
import sys

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(_backend_dir)
sys.path.insert(0, _backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass


async def main():
    from sqlalchemy import select
    from app.db.database import async_session_maker
    from app.models.user import User
    from app.core.permissions import UserRole
    from app.models.dealership import Dealership

    salesperson_and_admin_roles = [
        UserRole.SALESPERSON,
        UserRole.DEALERSHIP_ADMIN,
        UserRole.DEALERSHIP_OWNER,
        UserRole.SUPER_ADMIN,
    ]

    async with async_session_maker() as db:
        result = await db.execute(
            select(User, Dealership.name.label("dealership_name"))
            .outerjoin(Dealership, User.dealership_id == Dealership.id)
            .where(User.role.in_(salesperson_and_admin_roles))
            .where(User.is_active == True)
            .order_by(User.role.asc(), User.last_name.asc())
        )
        rows = result.all()

    if not rows:
        print("No salespersons or admins found.")
        return

    print("=" * 80)
    print("Salespersons & Admins – Name, Email, Role, Phone, Dealership")
    print("=" * 80)

    for user, dealership_name in rows:
        role_label = user.role.value.replace("_", " ").title()
        phone = user.phone or "(no phone)"
        dealership = dealership_name or "(none)"
        print(f"  {user.first_name} {user.last_name}")
        print(f"    Email:      {user.email}")
        print(f"    Role:       {role_label}")
        print(f"    Phone:      {phone}")
        print(f"    Dealership: {dealership}")
        print()

    print("=" * 80)
    print("Phones only (for copy-paste):")
    phones = [u.phone for u, _ in rows if u.phone]
    for p in phones:
        print(f"  {p}")
    if not phones:
        print("  (none with phone set)")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
