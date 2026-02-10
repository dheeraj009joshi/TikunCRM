"""
Clone data from SOURCE DB to TARGET (Neon) DB.
If source has the OLD lead schema (first_name, status on leads), data is upgraded
to the new structure (customers + lead_stages + leads with customer_id/stage_id)
before writing to Neon. Also ensures a super_admin exists in target.

Usage:
  1. Run migrations on TARGET first (Neon must have new schema):
     TARGET_DATABASE_URL="postgresql+asyncpg://..." alembic upgrade head
     (Or set DATABASE_URL to Neon and run: alembic upgrade head)

  2. Set env vars then run:
     SOURCE_DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname
     TARGET_DATABASE_URL=postgresql+asyncpg://...@...neon.tech/neondb?ssl=require
     python -m scripts.clone_to_neon

  3. Use Neon: set DATABASE_URL in .env to TARGET_DATABASE_URL and start the app.
"""
import asyncio
import os
import uuid
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


def _normalize_phone(phone: str | None) -> str:
    if not phone or not str(phone).strip():
        return ""
    return "".join(c for c in str(phone) if c.isdigit())[-10:] or str(phone).strip()


def _normalize_email(email: str | None) -> str:
    if not email or not str(email).strip():
        return ""
    return str(email).strip().lower()


async def _source_has_new_lead_schema(session: AsyncSession) -> bool:
    """True if leads table has customer_id (new schema)."""
    r = await session.execute(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'customer_id'
    """))
    return r.scalar() is not None


async def _get_target_stages_by_name(tgt: AsyncSession):
    """Return dict stage_name -> stage_id for global stages in target."""
    r = await tgt.execute(text(
        "SELECT id, name FROM lead_stages WHERE dealership_id IS NULL"
    ))
    return {row[1]: row[0] for row in r.fetchall()}


async def _copy_model(src: AsyncSession, tgt: AsyncSession, Model, table_name: str) -> int:
    """Copy all rows of Model from source to target using raw SQL for the SELECT.
    This avoids triggering ORM relationship loads (e.g. Lead) on the source, which
    would fail when source has old schema (leads without customer_id).
    Uses SELECT * so source can have fewer columns (older schema); only target columns are set.
    """
    table = Model.__table__
    target_column_set = {c.key for c in table.columns}
    try:
        r = await src.execute(text(f"SELECT * FROM {table.name}"))
        rows = r.fetchall()
        # Result column names (source may have fewer/different order)
        key_names = r.keys()
    except Exception as e:
        await src.rollback()
        err_msg = str(e).split("\n")[0] if "\n" in str(e) else str(e)
        if "does not exist" in err_msg or "UndefinedTableError" in str(type(e).__name__):
            print(f"  -> {table_name}: skip (table not on source)")
        else:
            print(f"  -> {table_name}: skip (source error: {err_msg})")
        return 0
    if not rows:
        return 0
    for row in rows:
        d = dict(zip(key_names, row))
        # Only pass columns that exist on target (handles source missing columns)
        d = {k: v for k, v in d.items() if k in target_column_set}
        tgt.add(Model(**d))
    await tgt.flush()
    print(f"  -> {len(rows)} {table_name}")
    return len(rows)


async def _copy_all_remaining_tables(src: AsyncSession, tgt: AsyncSession) -> None:
    """Copy all other app tables from source to target (FK order: depend on leads/users/dealerships)."""
    from app.models.activity import Activity
    from app.models.follow_up import FollowUp
    from app.models.appointment import Appointment
    from app.models.call_log import CallLog
    from app.models.email_log import EmailLog
    from app.models.sms_log import SMSLog
    from app.models.whatsapp_log import WhatsAppLog
    from app.models.showroom_visit import ShowroomVisit
    from app.models.notification import Notification
    from app.models.fcm_token import FCMToken
    from app.models.oauth_token import OAuthToken
    from app.models.password_reset import PasswordResetToken
    from app.models.schedule import Schedule
    from app.models.dealership_email_config import DealershipEmailConfig
    from app.models.email_template import EmailTemplate
    from app.models.whatsapp_template import WhatsAppTemplate

    print("Copying all remaining tables...")
    # Order: tables that reference leads, users, dealerships (already copied)
    await _copy_model(src, tgt, Activity, "activities")
    await _copy_model(src, tgt, FollowUp, "follow_ups")
    await _copy_model(src, tgt, Appointment, "appointments")
    await _copy_model(src, tgt, CallLog, "call_logs")
    await _copy_model(src, tgt, EmailLog, "email_logs")
    await _copy_model(src, tgt, SMSLog, "sms_logs")
    await _copy_model(src, tgt, WhatsAppLog, "whatsapp_logs")
    await _copy_model(src, tgt, ShowroomVisit, "showroom_visits")
    await _copy_model(src, tgt, Notification, "notifications")
    await _copy_model(src, tgt, FCMToken, "fcm_tokens")
    await _copy_model(src, tgt, OAuthToken, "oauth_tokens")
    await _copy_model(src, tgt, PasswordResetToken, "password_reset_tokens")
    await _copy_model(src, tgt, Schedule, "schedules")
    await _copy_model(src, tgt, DealershipEmailConfig, "dealership_email_configs")
    await _copy_model(src, tgt, EmailTemplate, "email_templates")
    await _copy_model(src, tgt, WhatsAppTemplate, "whatsapp_templates")


async def _clear_target_db(tgt: AsyncSession) -> None:
    """Delete all existing data on target (Neon) so the clone is a full copy. Order respects FKs."""
    print("Clearing existing data on target (Neon)...")
    # Order: truncate dependents first via CASCADE (leads -> activities, follow_ups, etc.; users -> notifications, fcm_tokens, etc.)
    await tgt.execute(text("TRUNCATE leads CASCADE"))
    await tgt.execute(text("TRUNCATE customers CASCADE"))
    await tgt.execute(text("TRUNCATE users CASCADE"))
    await tgt.execute(text("TRUNCATE lead_stages CASCADE"))
    await tgt.execute(text("TRUNCATE dealerships CASCADE"))
    await tgt.flush()
    print("  -> Target cleared.")


async def _seed_target_lead_stages(tgt: AsyncSession, LeadStage) -> None:
    """Re-seed global default lead_stages on target after clear (needed to map leads)."""
    from app.models.lead_stage import DEFAULT_STAGES
    for cfg in DEFAULT_STAGES:
        tgt.add(LeadStage(
            name=cfg["name"],
            display_name=cfg["display_name"],
            order=cfg["order"],
            color=cfg["color"],
            is_terminal=cfg["is_terminal"],
            dealership_id=None,
        ))
    await tgt.flush()
    print("  -> Seeded default lead_stages.")


async def main():
    source_url = os.environ.get("SOURCE_DATABASE_URL")
    target_url = os.environ.get(
        "TARGET_DATABASE_URL",
        os.environ.get("DATABASE_URL"),
    )
    source_url = async_url(source_url) if source_url else None
    target_url = async_url(target_url) if target_url else None

    if not target_url or "asyncpg" not in target_url:
        print("Set TARGET_DATABASE_URL or DATABASE_URL (e.g. postgresql+asyncpg://...?ssl=require).")
        return

    print("Target (Neon):", target_url.split("@")[1] if "@" in target_url else target_url[:60])
    if source_url:
        print("Source:", source_url.split("@")[1] if "@" in source_url else source_url[:60])
    else:
        print("No SOURCE_DATABASE_URL: will only ensure super admin in target.")

    from app.core.security import get_password_hash
    from app.core.permissions import UserRole
    from app.models.dealership import Dealership
    from app.models.user import User
    from app.models.lead import Lead, LeadSource
    from app.models.lead_stage import LeadStage
    from app.models.customer import Customer

    target_clean, target_args = _engine_url_and_ssl(target_url)
    target_engine = create_async_engine(
        target_clean, echo=False, poolclass=None, connect_args=target_args,
    )
    target_maker = async_sessionmaker(target_engine, class_=AsyncSession, expire_on_commit=False)

    if not source_url:
        async with target_maker() as tgt:
            await _ensure_super_admin(tgt, User, UserRole, get_password_hash, uuid)
            await tgt.commit()
        await target_engine.dispose()
        print("Done. Set SOURCE_DATABASE_URL and run again to clone from another DB.")
        return

    source_clean, source_args = _engine_url_and_ssl(source_url)
    source_engine = create_async_engine(
        source_clean, echo=False, poolclass=None, connect_args=source_args,
    )
    source_maker = async_sessionmaker(source_engine, class_=AsyncSession, expire_on_commit=False)

    async with source_maker() as src, target_maker() as tgt:
        # 0) Clear target so clone is a full copy of source
        await _clear_target_db(tgt)
        await _seed_target_lead_stages(tgt, LeadStage)

        # 1) Copy dealerships (preserve IDs)
        print("Copying dealerships...")
        existing_dealer_ids = {row[0] for row in (await tgt.execute(select(Dealership.id))).fetchall()}
        r = await src.execute(select(Dealership))
        dealerships = r.scalars().all()
        to_add = [d for d in dealerships if d.id not in existing_dealer_ids]
        for d in to_add:
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
        print(f"  -> {len(to_add)} dealerships (skipped {len(dealerships) - len(to_add)} already in target)")

        # 2) Copy users (preserve IDs); skip already present in target
        print("Copying users...")
        existing_user_ids = {row[0] for row in (await tgt.execute(select(User.id))).fetchall()}
        r = await src.execute(select(User))
        users = r.scalars().all()
        to_add_u = [u for u in users if u.id not in existing_user_ids]
        for u in to_add_u:
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
        print(f"  -> {len(to_add_u)} users (skipped {len(users) - len(to_add_u)} already in target)")

        # 3) Leads: detect source schema and copy (with upgrade if old)
        source_is_new = await _source_has_new_lead_schema(src)
        stages_by_name = await _get_target_stages_by_name(tgt)

        if source_is_new:
            await _copy_leads_new_schema(src, tgt, Lead, Customer, LeadStage, stages_by_name)
        else:
            await _copy_leads_old_schema_upgrade(src, tgt, stages_by_name, Customer, Lead, LeadSource)

        # 4) Copy all remaining tables (activities, appointments, follow_ups, logs, etc.)
        await _copy_all_remaining_tables(src, tgt)

        await _ensure_super_admin(tgt, User, UserRole, get_password_hash, uuid)
        await tgt.commit()

    await source_engine.dispose()
    await target_engine.dispose()
    print("Done. Set DATABASE_URL to the Neon URL to use the app.")


async def _ensure_super_admin(tgt, User, UserRole, get_password_hash, uuid):
    r = await tgt.execute(select(User).where(User.role == UserRole.SUPER_ADMIN).limit(1))
    if r.scalar_one_or_none():
        print("  -> Super admin already exists")
        return
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


async def _copy_leads_new_schema(src, tgt, Lead, Customer, LeadStage, stages_by_name):
    """Source and target both have new schema: copy customers, then leads (preserve IDs)."""
    print("Source has new schema: copying customers and leads...")

    # Map source stage_id -> stage name so we can use target stage_id (UUIDs differ)
    r_stages = await src.execute(text("SELECT id, name FROM lead_stages"))
    source_stage_id_to_name = {str(row[0]): row[1] for row in r_stages.fetchall()}
    default_stage_id = next(iter(stages_by_name.values()), None) if stages_by_name else None

    existing_customer_ids = {row[0] for row in (await tgt.execute(select(Customer.id))).fetchall()}
    existing_lead_ids = {row[0] for row in (await tgt.execute(select(Lead.id))).fetchall()}

    r = await src.execute(select(Customer))
    customers = r.scalars().all()
    customers_added = 0
    for c in customers:
        if c.id in existing_customer_ids:
            continue
        customers_added += 1
        tgt.add(Customer(
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
    await tgt.flush()
    print(f"  -> {customers_added} customers (skipped {len(customers) - customers_added} already in target)")

    r = await src.execute(select(Lead))
    leads = r.scalars().all()
    leads_added = 0
    for L in leads:
        if L.id in existing_lead_ids:
            continue
        stage_name = source_stage_id_to_name.get(str(L.stage_id), "new")
        target_stage_id = stages_by_name.get(stage_name) or default_stage_id
        if not target_stage_id:
            continue
        leads_added += 1
        tgt.add(Lead(
            id=L.id,
            customer_id=L.customer_id,
            stage_id=target_stage_id,
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
    await tgt.flush()
    print(f"  -> {leads_added} leads (skipped {len(leads) - leads_added} already in target)")


async def _copy_leads_old_schema_upgrade(src, tgt, stages_by_name, Customer, Lead, LeadSource):
    """Source has old lead schema: read via raw SQL, dedupe to customers, map status->stage, insert."""
    print("Source has old schema: upgrading to customers + leads...")

    # Skip leads already in target (re-run safe)
    existing_lead_ids = {row[0] for row in (await tgt.execute(select(Lead.id))).fetchall()}
    # Existing customers in target by key (phone/email) -> id
    r_existing = await tgt.execute(text("SELECT id, phone, email FROM customers"))
    existing_key_to_id: dict[str, uuid.UUID] = {}
    for row in r_existing.fetchall():
        cid, cphone, cemail = row
        if cphone and _normalize_phone(cphone):
            existing_key_to_id[_normalize_phone(cphone)] = cid
        if cemail and _normalize_email(cemail):
            existing_key_to_id[_normalize_email(cemail)] = cid

    # Default stage name if status not in lead_stages
    default_stage_name = "new"
    if default_stage_name not in stages_by_name and stages_by_name:
        default_stage_name = next(iter(stages_by_name.keys()))

    r = await src.execute(text("""
        SELECT id, first_name, last_name, email, phone, alternate_phone,
               address, city, state, postal_code, country, date_of_birth,
               company, job_title, preferred_contact_method, preferred_contact_time,
               source, status::text,
               dealership_id, assigned_to, created_by, notes, meta_data,
               external_id, interested_in, budget_range,
               first_contacted_at, last_contacted_at, last_activity_at,
               converted_at, created_at, updated_at
        FROM leads
    """))
    rows = r.fetchall()

    # Build unique customers (dedupe by phone, then email); reuse existing target customers
    key_to_customer_id: dict[str, uuid.UUID] = {}
    customers_to_insert: list[dict] = []  # list of dicts for Customer rows

    for row in rows:
        lead_id, first_name, last_name, email, phone, alternate_phone, \
        address, city, state, postal_code, country, date_of_birth, \
        company, job_title, preferred_contact_method, preferred_contact_time, \
        source, status, dealership_id, assigned_to, created_by, notes, meta_data, \
        external_id, interested_in, budget_range, \
        first_contacted_at, last_contacted_at, last_activity_at, \
        converted_at, created_at, updated_at = row

        first_name = first_name or ""
        last_name = last_name or ""
        phone = (phone or "").strip()
        email = _normalize_email(email)
        key = _normalize_phone(phone) or email or str(lead_id)
        if key not in key_to_customer_id:
            existing_id = existing_key_to_id.get(key)
            if existing_id is not None:
                key_to_customer_id[key] = existing_id
            else:
                cid = uuid.uuid4()
                key_to_customer_id[key] = cid
                source_val = source.value if hasattr(source, "value") else (source or "unknown")
                customers_to_insert.append({
                "id": cid,
                "first_name": first_name or "Unknown",
                "last_name": last_name or None,
                "phone": phone or None,
                "email": email or None,
                "alternate_phone": (alternate_phone or "").strip() or None,
                "address": (address or "").strip() or None,
                "city": (city or "").strip() or None,
                "state": (state or "").strip() or None,
                "postal_code": (postal_code or "").strip() or None,
                "country": (country or "").strip() or None,
                "date_of_birth": date_of_birth,
                "company": (company or "").strip() or None,
                "job_title": (job_title or "").strip() or None,
                "preferred_contact_method": (preferred_contact_method or "").strip() or None,
                "preferred_contact_time": (preferred_contact_time or "").strip() or None,
                "source_first_touch": source_val,
                "meta_data": meta_data if meta_data is not None else {},
                "created_at": created_at or datetime.now(timezone.utc),
                "updated_at": updated_at or datetime.now(timezone.utc),
            })

    for c in customers_to_insert:
        tgt.add(Customer(
            id=c["id"],
            first_name=c["first_name"],
            last_name=c["last_name"],
            phone=c["phone"],
            email=c["email"],
            alternate_phone=c["alternate_phone"],
            address=c["address"],
            city=c["city"],
            state=c["state"],
            postal_code=c["postal_code"],
            country=c["country"],
            date_of_birth=c["date_of_birth"],
            company=c["company"],
            job_title=c["job_title"],
            preferred_contact_method=c["preferred_contact_method"],
            preferred_contact_time=c["preferred_contact_time"],
            source_first_touch=c["source_first_touch"],
            meta_data=c.get("meta_data") or {},
            created_at=c["created_at"],
            updated_at=c["updated_at"],
        ))
    await tgt.flush()
    print(f"  -> {len(customers_to_insert)} customers (deduped from {len(rows)} leads)")

    # Map status -> is_active, outcome (same as migration)
    terminal_outcomes = {"converted", "lost", "not_interested", "couldnt_qualify"}
    leads_added_old = 0

    for row in rows:
        lead_id, first_name, last_name, email, phone, alternate_phone, \
        address, city, state, postal_code, country, date_of_birth, \
        company, job_title, preferred_contact_method, preferred_contact_time, \
        source, status, dealership_id, assigned_to, created_by, notes, meta_data, \
        external_id, interested_in, budget_range, \
        first_contacted_at, last_contacted_at, last_activity_at, \
        converted_at, created_at, updated_at = row

        if lead_id in existing_lead_ids:
            continue

        phone = (phone or "").strip()
        email = _normalize_email(email)
        key = _normalize_phone(phone) or email or str(lead_id)
        customer_id = key_to_customer_id[key]

        status_str = (status or "new").lower().replace(" ", "_")
        if status_str in stages_by_name:
            stage_id = stages_by_name[status_str]
        else:
            stage_id = stages_by_name.get(default_stage_name)
        if not stage_id and stages_by_name:
            stage_id = next(iter(stages_by_name.values()))

        is_active = status_str not in terminal_outcomes
        outcome = None
        if status_str == "converted":
            outcome = "converted"
        elif status_str == "lost":
            outcome = "lost"
        elif status_str in ("not_interested", "couldnt_qualify"):
            outcome = status_str

        raw_source = source.value if hasattr(source, "value") else (source or "manual")
        if isinstance(raw_source, str):
            try:
                lead_source = LeadSource(raw_source)
            except ValueError:
                lead_source = LeadSource.MANUAL
        else:
            lead_source = LeadSource.MANUAL

        leads_added_old += 1
        tgt.add(Lead(
            id=lead_id,
            customer_id=customer_id,
            stage_id=stage_id,
            source=lead_source,
            is_active=is_active,
            outcome=outcome,
            interest_score=0,
            dealership_id=dealership_id,
            assigned_to=assigned_to,
            secondary_salesperson_id=None,
            created_by=created_by,
            notes=notes,
            meta_data=meta_data or {},
            external_id=external_id,
            interested_in=interested_in,
            budget_range=budget_range,
            first_contacted_at=first_contacted_at,
            last_contacted_at=last_contacted_at,
            last_activity_at=last_activity_at,
            converted_at=converted_at,
            closed_at=converted_at if outcome else None,
            created_at=created_at,
            updated_at=updated_at,
        ))
    await tgt.flush()
    print(f"  -> {leads_added_old} leads (skipped {len(rows) - leads_added_old} already in target)")


if __name__ == "__main__":
    asyncio.run(main())
