"""
Create or update Miguel Rivera as a BDC agent and assign dealerships.

Usage (from backend/):
  python -m scripts.create_bdc_miguel --email miguel@example.com --password 'TempPass123!' \\
    --dealership-ids <uuid1> <uuid2>

Or set env and run with no args after editing defaults below.
"""
import argparse
import asyncio
import uuid

from sqlalchemy import select, delete

from app.db.database import async_session_maker
from app.core.permissions import UserRole
from app.core.security import get_password_hash
from app.models.user import User
from app.models.dealership import Dealership
from app.models.user_dealership_access import UserDealershipAccess


async def main(
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    dealership_ids: list[uuid.UUID],
) -> None:
    async with async_session_maker() as db:
        email_norm = email.strip().lower()
        result = await db.execute(
            select(User).where(
                User.email == email_norm,
                User.dealership_id.is_(None),
            )
        )
        user = result.scalar_one_or_none()

        if user:
            user.role = UserRole.BDC
            user.first_name = first_name
            user.last_name = last_name
            user.is_active = True
            print(f"Updated existing user {user.id} to BDC")
        else:
            user = User(
                email=email_norm,
                password_hash=get_password_hash(password),
                first_name=first_name,
                last_name=last_name,
                role=UserRole.BDC,
                dealership_id=None,
                is_active=True,
                must_change_password=True,
            )
            db.add(user)
            await db.flush()
            print(f"Created BDC user {user.id}")

        if dealership_ids:
            for did in dealership_ids:
                d = await db.get(Dealership, did)
                if not d or not d.is_active:
                    raise SystemExit(f"Invalid dealership: {did}")
            await db.execute(
                delete(UserDealershipAccess).where(
                    UserDealershipAccess.user_id == user.id
                )
            )
            for did in dealership_ids:
                db.add(
                    UserDealershipAccess(
                        user_id=user.id,
                        dealership_id=did,
                    )
                )
            print(f"Assigned {len(dealership_ids)} dealership(s)")

        await db.commit()
        print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create Miguel Rivera BDC user")
    parser.add_argument("--email", default="miguel.rivera@tikuncrm.com")
    parser.add_argument("--password", default="ChangeMe123!")
    parser.add_argument("--first-name", default="Miguel")
    parser.add_argument("--last-name", default="Rivera")
    parser.add_argument(
        "--dealership-ids",
        nargs="*",
        default=[],
        help="UUIDs of dealerships to assign",
    )
    args = parser.parse_args()
    ids = [uuid.UUID(x) for x in args.dealership_ids]
    asyncio.run(
        main(
            args.email,
            args.password,
            args.first_name,
            args.last_name,
            ids,
        )
    )
