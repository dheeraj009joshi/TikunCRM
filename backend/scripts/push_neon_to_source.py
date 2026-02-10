"""
Push data from the upgraded DB (Neon) back to the source DB.
Use after cloning source → Neon and running migrations on source so both DBs have
the same schema. This overwrites core tables on source with Neon data so both match.

WARNING: This overwrites dealerships, users, customers, and leads on the source DB.
Take a full backup of the source DB before running (e.g. scripts/backup_db_to_file.py).

Usage:
  1. Run migrations on source first so source has the new schema:
     SOURCE_DATABASE_URL="postgresql+asyncpg://..." python -m scripts.run_migrations_source

  2. Set env vars and run (SOURCE = write target, TARGET/DATABASE = Neon to read from):
     SOURCE_DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/source_db
     TARGET_DATABASE_URL=postgresql+asyncpg://...@...neon.tech/neondb?ssl=require
     python -m scripts.push_neon_to_source
"""
import asyncio
import os
from datetime import datetime, timezone
from decimal import Decimal

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker


def async_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _engine_url_and_ssl(url: str):
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
    # SOURCE = where we write (the DB we're re-pushing to)
    # TARGET/Neon = where we read from (upgraded DB with converted data)
    source_url = os.environ.get("SOURCE_DATABASE_URL")
    neon_url = os.environ.get(
        "TARGET_DATABASE_URL",
        os.environ.get("DATABASE_URL"),
    )
    source_url = async_url(source_url) if source_url else None
    neon_url = async_url(neon_url) if neon_url else None

    if not source_url or "asyncpg" not in source_url:
        print("Set SOURCE_DATABASE_URL (postgresql+asyncpg://...) - the DB to write to.")
        return
    if not neon_url or "asyncpg" not in neon_url:
        print("Set TARGET_DATABASE_URL or DATABASE_URL (Neon / upgraded DB to read from).")
        return

    print("Reading from Neon (target):", neon_url.split("@")[1] if "@" in neon_url else neon_url[:60])
    print("Writing to source:", source_url.split("@")[1] if "@" in source_url else source_url[:60])

    from app.models.dealership import Dealership
    from app.models.user import User
    from app.models.lead import Lead
    from app.models.lead_stage import LeadStage
    from app.models.customer import Customer

    source_clean, source_args = _engine_url_and_ssl(source_url)
    neon_clean, neon_args = _engine_url_and_ssl(neon_url)
    source_engine = create_async_engine(
        source_clean, echo=False, poolclass=None, connect_args=source_args,
    )
    neon_engine = create_async_engine(
        neon_clean, echo=False, poolclass=None, connect_args=neon_args,
    )
    source_maker = async_sessionmaker(source_engine, class_=AsyncSession, expire_on_commit=False)
    neon_maker = async_sessionmaker(neon_engine, class_=AsyncSession, expire_on_commit=False)

    async with source_maker() as src, neon_maker() as neon:
        # 1) Neon stage_id -> stage name (for remapping leads later)
        r_neon_stages = await neon.execute(text(
            "SELECT id, name FROM lead_stages WHERE dealership_id IS NULL"
        ))
        neon_stage_id_to_name = {str(row[0]): row[1] for row in r_neon_stages.fetchall()}

        # 2) Clear source tables (CASCADE removes lead_stages when we truncate dealerships)
        print("Clearing source core tables (CASCADE)...")
        await src.execute(text("TRUNCATE leads CASCADE"))
        await src.execute(text("TRUNCATE customers CASCADE"))
        await src.execute(text("TRUNCATE users CASCADE"))
        await src.execute(text("TRUNCATE lead_stages CASCADE"))
        await src.execute(text("TRUNCATE dealerships CASCADE"))
        await src.flush()
        print("  -> Cleared leads, customers, users, lead_stages, dealerships")

        # 3) Copy dealerships from Neon to source (preserve IDs)
        print("Copying dealerships...")
        r = await neon.execute(select(Dealership))
        dealerships = r.scalars().all()
        for d in dealerships:
            src.add(Dealership(
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
        await src.flush()
        print(f"  -> {len(dealerships)} dealerships")

        # 3b) Seed default lead_stages on source (so leads can reference them)
        from app.models.lead_stage import DEFAULT_STAGES
        for cfg in DEFAULT_STAGES:
            src.add(LeadStage(
                name=cfg["name"],
                display_name=cfg["display_name"],
                order=cfg["order"],
                color=cfg["color"],
                is_terminal=cfg["is_terminal"],
                dealership_id=None,
            ))
        await src.flush()
        print("  -> Seeded default lead_stages on source")

        # Build source stage name -> id (must be after seed)
        r_src_stages = await src.execute(text(
            "SELECT id, name FROM lead_stages WHERE dealership_id IS NULL"
        ))
        source_name_to_stage_id = {row[1]: row[0] for row in r_src_stages.fetchall()}
        default_src_stage_id = next(iter(source_name_to_stage_id.values()), None) if source_name_to_stage_id else None

        # 4) Copy users from Neon to source (preserve IDs)
        print("Copying users...")
        r = await neon.execute(select(User))
        users = r.scalars().all()
        for u in users:
            src.add(User(
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
        await src.flush()
        print(f"  -> {len(users)} users")

        # 5) Copy customers from Neon to source (preserve IDs)
        print("Copying customers...")
        r = await neon.execute(select(Customer))
        customers = r.scalars().all()
        for c in customers:
            src.add(Customer(
                id=c.id,
                first_name=c.first_name,
                last_name=c.last_name,
                phone=c.phone,
                email=c.email,
                alternate_phone=c.alternate_phone,
                whatsapp=getattr(c, "whatsapp", None),
                address=c.address,
                city=c.city,
                state=c.state,
                postal_code=c.postal_code,
                country=c.country,
                date_of_birth=c.date_of_birth,
                company=c.company,
                job_title=c.job_title,
                preferred_contact_method=c.preferred_contact_method,
                preferred_contact_time=c.preferred_contact_time,
                source_first_touch=c.source_first_touch,
                lifetime_value=getattr(c, "lifetime_value", Decimal("0")) or Decimal("0"),
                meta_data=getattr(c, "meta_data", {}) or {},
                created_at=c.created_at,
                updated_at=c.updated_at,
            ))
        await src.flush()
        print(f"  -> {len(customers)} customers")

        # 6) Copy leads from Neon to source with stage_id remapped to source's lead_stages
        print("Copying leads...")
        r = await neon.execute(select(Lead))
        leads = r.scalars().all()
        for L in leads:
            stage_name = neon_stage_id_to_name.get(str(L.stage_id), "new")
            source_stage_id = source_name_to_stage_id.get(stage_name) or default_src_stage_id
            if not source_stage_id:
                continue
            src.add(Lead(
                id=L.id,
                customer_id=L.customer_id,
                secondary_customer_id=getattr(L, "secondary_customer_id", None),
                stage_id=source_stage_id,
                source=L.source,
                is_active=L.is_active,
                outcome=L.outcome,
                interest_score=getattr(L, "interest_score", 0) or 0,
                dealership_id=L.dealership_id,
                assigned_to=L.assigned_to,
                secondary_salesperson_id=getattr(L, "secondary_salesperson_id", None),
                created_by=L.created_by,
                notes=L.notes,
                meta_data=L.meta_data or {},
                external_id=L.external_id,
                interested_in=L.interested_in,
                budget_range=L.budget_range,
                first_contacted_at=L.first_contacted_at,
                last_contacted_at=L.last_contacted_at,
                last_activity_at=L.last_activity_at,
                converted_at=L.converted_at,
                closed_at=getattr(L, "closed_at", None),
                created_at=L.created_at,
                updated_at=L.updated_at,
            ))
        await src.flush()
        print(f"  -> {len(leads)} leads")

        await src.commit()

    await source_engine.dispose()
    await neon_engine.dispose()
    print("Done. Source DB now has the same core data as Neon.")


if __name__ == "__main__":
    asyncio.run(main())
