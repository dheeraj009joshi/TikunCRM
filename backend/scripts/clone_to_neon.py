"""
Clone users, leads, and dealerships from SOURCE DB to TARGET (Neon) DB.
Also ensures a super_admin exists in target (admin@leedscrm.com / admin123).

Usage:
  1. Run migrations on TARGET first (schema must exist):
     TARGET_DATABASE_URL="postgresql+asyncpg://..." alembic upgrade head
     (Or temporarily set DATABASE_URL to Neon URL and run: alembic upgrade head)

  2. Set env vars then run this script:
     SOURCE_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/leedscrm
     TARGET_DATABASE_URL=postgresql+asyncpg://neondb_owner:...@...neon.tech/neondb?ssl=require
     python -m scripts.clone_to_neon

  3. For local use with Neon from now on, set in .env:
     DATABASE_URL=<same as TARGET_DATABASE_URL>
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

# Load .env from backend directory so SOURCE_DATABASE_URL / DATABASE_URL are set
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Build sync-style URL for drivers that need it (we use asyncpg)
def async_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _engine_url_and_ssl(url: str):
    """Strip ssl/sslmode from URL and return (clean_url, connect_args). asyncpg rejects sslmode in URL."""
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    use_ssl = "ssl=require" in url or "sslmode=require" in url
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        qs.pop("ssl", None)
        qs.pop("sslmode", None)
        new_query = urlencode([(k, v[0]) for k, v in qs.items()])
        url = urlunparse(parsed._replace(query=new_query))
    connect_args = {"ssl": True} if use_ssl else {}
    return url, connect_args


async def main():
    source_url = os.environ.get("SOURCE_DATABASE_URL")
    target_url = os.environ.get(
        "TARGET_DATABASE_URL",
        os.environ.get("DATABASE_URL", "postgresql+asyncpg://neondb_owner:npg_UTdSwB9IWGu3@ep-floral-resonance-a18h7knm-pooler.ap-southeast-1.aws.neon.tech/neondb?ssl=require"),
    )

    source_url = async_url(source_url) if source_url else None
    target_url = async_url(target_url) if target_url else None

    if not target_url or "asyncpg" not in target_url:
        print("Set TARGET_DATABASE_URL or DATABASE_URL (Neon async URL, e.g. postgresql+asyncpg://...?sslmode=require).")
        return

    print("Target (Neon):", target_url.split("@")[1] if "@" in target_url else target_url[:60])
    if source_url:
        print("Source:", source_url.split("@")[1] if "@" in source_url else source_url[:60])
    else:
        print("No SOURCE_DATABASE_URL: will only ensure super admin exists in target.")

    # Import models and deps after we know we have URLs
    from app.core.security import get_password_hash
    from app.core.permissions import UserRole
    from app.models.dealership import Dealership
    from app.models.user import User
    from app.models.lead import Lead

    target_clean, target_args = _engine_url_and_ssl(target_url)
    target_engine = create_async_engine(
        target_clean,
        echo=False,
        poolclass=None,
        connect_args=target_args,
    )
    target_maker = async_sessionmaker(target_engine, class_=AsyncSession, expire_on_commit=False)

    if source_url:
        source_clean, source_args = _engine_url_and_ssl(source_url)
        source_engine = create_async_engine(
            source_clean,
            echo=False,
            poolclass=None,
            connect_args=source_args,
        )
        source_maker = async_sessionmaker(source_engine, class_=AsyncSession, expire_on_commit=False)
    else:
        source_engine = None
        source_maker = None

    async def ensure_admin_and_commit(tgt: AsyncSession):
        # Ensure super_admin exists in target
        r = await tgt.execute(select(User).where(User.role == UserRole.SUPER_ADMIN))
        existing = r.scalar_one_or_none()
        if not existing:
            admin = User(
                id=uuid.uuid4(),
                email="admin@leedscrm.com",
                password_hash=get_password_hash("admin123"),
                first_name="System",
                last_name="Administrator",
                role=UserRole.SUPER_ADMIN,
                dealership_id=None,
                is_active=True,
                is_verified=True,
                must_change_password=False,
            )
            tgt.add(admin)
            print("  -> Created super admin: admin@leedscrm.com / admin123")
        else:
            print("  -> Super admin already exists")
        await tgt.commit()

    if not source_url:
        async with target_maker() as tgt:
            await ensure_admin_and_commit(tgt)
        await target_engine.dispose()
        print("Done. Set SOURCE_DATABASE_URL and run again to clone users/leads from another DB.")
        return

    source_maker = async_sessionmaker(source_engine, class_=AsyncSession, expire_on_commit=False)

    async with source_maker() as src, target_maker() as tgt:
        # 1) Copy dealerships (preserve IDs)
        print("Copying dealerships...")
        r = await src.execute(select(Dealership))
        dealerships = r.scalars().all()
        for d in dealerships:
            tgt.add(Dealership(
                id=d.id,
                name=d.name,
                slug=d.slug,
                address=d.address,
                city=d.city,
                state=d.state,
                country=d.country,
                postal_code=d.postal_code,
                phone=d.phone,
                email=d.email,
                website=d.website,
                config=d.config or {},
                working_hours=d.working_hours or {},
                lead_assignment_rules=d.lead_assignment_rules or {},
                timezone=d.timezone,
                is_active=d.is_active,
                created_at=d.created_at,
                updated_at=d.updated_at,
            ))
        await tgt.flush()
        print(f"  -> {len(dealerships)} dealerships")

        # 2) Copy users (preserve IDs)
        print("Copying users...")
        r = await src.execute(select(User))
        users = r.scalars().all()
        for u in users:
            tgt.add(User(
                id=u.id,
                email=u.email,
                password_hash=u.password_hash,
                first_name=u.first_name,
                last_name=u.last_name,
                phone=u.phone,
                avatar_url=u.avatar_url,
                role=u.role,
                dealership_id=u.dealership_id,
                is_active=u.is_active,
                is_verified=getattr(u, "is_verified", False),
                must_change_password=getattr(u, "must_change_password", False),
                created_at=getattr(u, "created_at", datetime.now(timezone.utc)),
                updated_at=getattr(u, "updated_at", datetime.now(timezone.utc)),
            ))
        await tgt.flush()
        print(f"  -> {len(users)} users")

        # 3) Copy leads (preserve IDs)
        print("Copying leads...")
        r = await src.execute(select(Lead))
        leads = r.scalars().all()
        for L in leads:
            tgt.add(Lead(
                id=L.id,
                first_name=L.first_name,
                last_name=L.last_name,
                email=L.email,
                phone=L.phone,
                alternate_phone=L.alternate_phone,
                source=L.source,
                status=L.status,
                dealership_id=L.dealership_id,
                assigned_to=L.assigned_to,
                secondary_salesperson_id=getattr(L, "secondary_salesperson_id", None),
                created_by=L.created_by,
                notes=L.notes,
                meta_data=L.meta_data or {},
                external_id=L.external_id,
                interested_in=L.interested_in,
                budget_range=L.budget_range,
                address=L.address,
                city=L.city,
                state=L.state,
                postal_code=L.postal_code,
                country=L.country,
                date_of_birth=L.date_of_birth,
                company=L.company,
                job_title=L.job_title,
                preferred_contact_method=L.preferred_contact_method,
                preferred_contact_time=L.preferred_contact_time,
                first_contacted_at=L.first_contacted_at,
                last_contacted_at=L.last_contacted_at,
                last_activity_at=L.last_activity_at,
                converted_at=L.converted_at,
                created_at=L.created_at,
                updated_at=L.updated_at,
            ))
        await tgt.flush()
        print(f"  -> {len(leads)} leads")

        # 4) Ensure super_admin exists in target (may have multiple after clone)
        r = await tgt.execute(select(User).where(User.role == UserRole.SUPER_ADMIN).limit(1))
        existing = r.scalar_one_or_none()
        if not existing:
            admin = User(
                id=uuid.uuid4(),
                email="admin@leedscrm.com",
                password_hash=get_password_hash("admin123"),
                first_name="System",
                last_name="Administrator",
                role=UserRole.SUPER_ADMIN,
                dealership_id=None,
                is_active=True,
                is_verified=True,
                must_change_password=False,
            )
            tgt.add(admin)
            print("  -> Created super admin: admin@leedscrm.com / admin123")
        else:
            print("  -> Super admin already exists")

        await tgt.commit()

    await source_engine.dispose()
    await target_engine.dispose()
    print("Done. You can now set DATABASE_URL to the Neon URL for local use.")


if __name__ == "__main__":
    asyncio.run(main())
