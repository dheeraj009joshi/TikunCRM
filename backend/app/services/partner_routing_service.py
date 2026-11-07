"""
Route a new lead to partner stores.

Full BDC wins the whole lead when any full-BDC program matches.
Otherwise the lead is copied once per brand to a single leads-only store.
"""
import logging
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Iterable, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.models.activity import ActivityType
from app.models.customer import Customer
from app.models.lead import Lead
from app.models.lead_delivery import (
    AGENT_OPEN_STATUSES,
    DELIVERY_APPOINTMENT_SET,
    DELIVERY_DELIVERED,
    LOCKING_STATUSES,
    LeadDelivery,
)
from app.models.partner_bdc_agent import PartnerBdcAgent
from app.models.partner_program import (
    PROGRAM_ACTIVE,
    PROGRAM_FULL_BDC,
    PROGRAM_LEADS_ONLY,
    PartnerProgram,
)
from app.models.partner_store import PartnerStore
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.services.activity import ActivityService

logger = logging.getLogger(__name__)

_UNBOUNDED = 10**9
_WEEKDAYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


def brand_key(value: Optional[str]) -> str:
    return (value or "").strip().casefold()


def _as_list(value) -> list:
    if isinstance(value, list):
        return value
    return []


def _norm_token(value: Optional[str]) -> str:
    return (value or "").strip().upper()


def program_is_open(hours: Optional[dict], tz_name: Optional[str], now: datetime) -> bool:
    """Empty hours means the store accepts leads at any time."""
    if not hours:
        return True
    try:
        zone = ZoneInfo(tz_name or "America/New_York")
    except Exception:
        zone = ZoneInfo("America/New_York")
    local = now.astimezone(zone)
    day = hours.get(_WEEKDAYS[local.weekday()]) or {}
    if not isinstance(day, dict) or not day:
        return True
    if day.get("is_open") is False:
        return False
    start = day.get("start")
    end = day.get("end")
    if not start or not end:
        return True
    current = local.strftime("%H:%M")
    return str(start) <= current <= str(end)


def _period_start(tz_name: Optional[str], now: datetime, *, month: bool) -> datetime:
    try:
        zone = ZoneInfo(tz_name or "America/New_York")
    except Exception:
        zone = ZoneInfo("America/New_York")
    local = now.astimezone(zone)
    if month:
        start = datetime(local.year, local.month, 1, tzinfo=zone)
    else:
        start = datetime.combine(local.date(), time.min, tzinfo=zone)
    return start.astimezone(timezone.utc)


def _area_matches(program: PartnerProgram, customer: Customer) -> bool:
    states = [_norm_token(item) for item in _as_list(program.states) if str(item).strip()]
    zips = [str(item).strip() for item in _as_list(program.postal_codes) if str(item).strip()]
    if not states and not zips:
        return True
    cust_state = _norm_token(customer.state)
    cust_zip = (customer.postal_code or "").strip()
    if states and not cust_state:
        return False
    if zips and not cust_zip:
        return False
    if states and cust_state not in states:
        return False
    if zips and cust_zip not in zips:
        return False
    return True


def _credit_matches(program: PartnerProgram, customer: Customer) -> bool:
    if program.min_credit_score is None and program.max_credit_score is None:
        return True
    if customer.credit_score is None:
        return False
    if program.min_credit_score is not None and customer.credit_score < program.min_credit_score:
        return False
    if program.max_credit_score is not None and customer.credit_score > program.max_credit_score:
        return False
    return True


def _down_payment_matches(program: PartnerProgram, lead: Lead) -> bool:
    if program.min_down_payment is None:
        return True
    if lead.down_payment is None:
        return False
    return Decimal(lead.down_payment) >= Decimal(program.min_down_payment)


def _remaining(cap: Optional[int], used: int) -> int:
    if cap is None:
        return _UNBOUNDED
    return cap - used


def pick_store(candidates: list, usage: dict) -> Optional[tuple]:
    """Furthest under cap, then higher priority weight. None when every store is full."""
    viable = []
    for program, store in candidates:
        day_used, month_used = usage.get(store.id, (0, 0))
        day_left = _remaining(program.daily_cap, day_used)
        month_left = _remaining(program.monthly_cap, month_used)
        if day_left <= 0 or month_left <= 0:
            continue
        viable.append(((month_left, day_left, program.priority_weight or 0), program, store))
    if not viable:
        return None
    viable.sort(key=lambda item: item[0], reverse=True)
    _, program, store = viable[0]
    return program, store


async def route_lead_safely(db: AsyncSession, lead_id: UUID) -> list[LeadDelivery]:
    """Route inside a savepoint so a routing error does not roll back the lead."""
    try:
        async with db.begin_nested():
            return await route_lead(db, lead_id)
    except Exception:
        logger.exception("Partner routing failed for lead %s", lead_id)
        return []


async def route_lead(db: AsyncSession, lead_id: UUID) -> list[LeadDelivery]:
    lead = await db.get(Lead, lead_id)
    if lead is None or not lead.is_active:
        return []
    customer = await db.get(Customer, lead.customer_id)
    if customer is None:
        return []

    existing = list(
        (
            await db.execute(
                select(LeadDelivery).where(LeadDelivery.customer_id == customer.id)
            )
        ).scalars().all()
    )
    if any(
        row.program_type == PROGRAM_FULL_BDC and row.status in LOCKING_STATUSES
        for row in existing
    ):
        return []

    locking_brands = {
        row.brand_key for row in existing if row.status in LOCKING_STATUSES
    }
    stores_already = {row.partner_store_id for row in existing}
    has_open_leads_only = any(
        row.program_type == PROGRAM_LEADS_ONLY and row.status in LOCKING_STATUSES
        for row in existing
    )

    now = utc_now()
    rows = (
        await db.execute(
            select(PartnerProgram, PartnerStore)
            .join(PartnerStore, PartnerStore.id == PartnerProgram.partner_store_id)
            .where(
                PartnerProgram.status == PROGRAM_ACTIVE,
                PartnerStore.is_active.is_(True),
            )
        )
    ).all()

    matched: list[tuple[PartnerProgram, PartnerStore]] = []
    for program, store in rows:
        if not _area_matches(program, customer):
            continue
        if not _credit_matches(program, customer):
            continue
        if not _down_payment_matches(program, lead):
            continue
        if not program_is_open(program.hours or {}, program.timezone, now):
            continue
        matched.append((program, store))

    if not matched:
        return []

    usage = await _cap_usage(db, [store.id for _, store in matched], matched, now)
    created: list[LeadDelivery] = []

    if not has_open_leads_only and not locking_brands:
        bdc_candidates = [
            (program, store)
            for program, store in matched
            if program.program_type == PROGRAM_FULL_BDC and store.id not in stores_already
        ]
        winner = pick_store(bdc_candidates, usage)
        if winner is not None:
            program, store = winner
            delivery = await _create_delivery(
                db,
                lead=lead,
                customer=customer,
                store=store,
                program=program,
                brand=store.brand or "General",
            )
            if delivery is not None:
                await _assign_agent(db, delivery)
                created.append(delivery)
            return created

    groups: dict[str, list[tuple[PartnerProgram, PartnerStore]]] = {}
    for program, store in matched:
        if program.program_type != PROGRAM_LEADS_ONLY:
            continue
        key = brand_key(store.brand)
        if not key or key in locking_brands or store.id in stores_already:
            continue
        groups.setdefault(key, []).append((program, store))

    customer_name = _customer_name(customer)
    for _key, group in groups.items():
        winner = pick_store(group, usage)
        if winner is None:
            continue
        program, store = winner
        delivery = await _create_delivery(
            db,
            lead=lead,
            customer=customer,
            store=store,
            program=program,
            brand=store.brand or "",
        )
        if delivery is None:
            continue
        stores_already.add(store.id)
        locking_brands.add(delivery.brand_key)
        day_used, month_used = usage.get(store.id, (0, 0))
        usage[store.id] = (day_used + 1, month_used + 1)
        await _email_store(
            store,
            subject=f"New {delivery.brand} lead",
            message=(
                f"{customer_name} was delivered to {store.name} for {delivery.brand}. "
                f"Phone: {customer.phone or 'n/a'}. Email: {customer.email or 'n/a'}."
            ),
        )
        created.append(delivery)

    return created


async def _cap_usage(
    db: AsyncSession,
    store_ids: Iterable[UUID],
    matched: list[tuple[PartnerProgram, PartnerStore]],
    now: datetime,
) -> dict:
    ids = list({store_id for store_id in store_ids})
    if not ids:
        return {}
    earliest = min(
        _period_start(program.timezone, now, month=True) for program, _store in matched
    )
    rows = (
        await db.execute(
            select(LeadDelivery.partner_store_id, LeadDelivery.delivered_at).where(
                LeadDelivery.partner_store_id.in_(ids),
                LeadDelivery.status != "returned",
                LeadDelivery.delivered_at >= earliest,
            )
        )
    ).all()
    by_store: dict = {store_id: [] for store_id in ids}
    for store_id, delivered_at in rows:
        by_store.setdefault(store_id, []).append(delivered_at)

    usage = {}
    programs_by_store = {store.id: program for program, store in matched}
    for store_id, stamps in by_store.items():
        program = programs_by_store.get(store_id)
        if program is None:
            continue
        day_start = _period_start(program.timezone, now, month=False)
        month_start = _period_start(program.timezone, now, month=True)
        usage[store_id] = (
            sum(1 for stamp in stamps if stamp >= day_start),
            sum(1 for stamp in stamps if stamp >= month_start),
        )
    return usage


async def _create_delivery(
    db: AsyncSession,
    *,
    lead: Lead,
    customer: Customer,
    store: PartnerStore,
    program: PartnerProgram,
    brand: str,
) -> Optional[LeadDelivery]:
    display = (brand or "").strip() or "General"
    delivery = LeadDelivery(
        lead_id=lead.id,
        customer_id=customer.id,
        brand=display,
        brand_key=brand_key(display),
        partner_store_id=store.id,
        program_type=program.program_type,
        status=DELIVERY_DELIVERED,
        delivered_at=utc_now(),
        updated_at=utc_now(),
    )
    try:
        async with db.begin_nested():
            db.add(delivery)
            await db.flush()
    except IntegrityError:
        logger.info(
            "Skipped duplicate delivery lead=%s store=%s brand=%s",
            lead.id,
            store.id,
            display,
        )
        return None

    label = "full BDC" if program.program_type == PROGRAM_FULL_BDC else "leads only"
    await ActivityService.log_activity(
        db,
        activity_type=ActivityType.LEAD_UPDATED,
        description=f"Lead delivered to {store.name} ({display}, {label})",
        lead_id=lead.id,
        dealership_id=lead.dealership_id,
        meta_data={
            "partner_store_id": str(store.id),
            "partner_store_name": store.name,
            "brand": display,
            "program_type": program.program_type,
            "delivery_id": str(delivery.id),
        },
    )
    return delivery


async def _assign_agent(db: AsyncSession, delivery: LeadDelivery) -> None:
    agent_id = await _pick_bdc_agent(db, delivery.partner_store_id)
    if agent_id is not None:
        delivery.bdc_agent_id = agent_id
        delivery.updated_at = utc_now()
        await db.flush()


async def _pick_bdc_agent(db: AsyncSession, store_id: UUID) -> Optional[UUID]:
    assignments = list(
        (
            await db.execute(
                select(PartnerBdcAgent, User)
                .join(User, User.id == PartnerBdcAgent.user_id)
                .join(TimeEntry, TimeEntry.user_id == User.id)
                .where(
                    PartnerBdcAgent.partner_store_id == store_id,
                    User.is_active.is_(True),
                    TimeEntry.clock_out_at.is_(None),
                )
            )
        ).all()
    )
    if not assignments:
        return None

    agent_ids = [user.id for _assignment, user in assignments]
    counts = dict(
        (
            await db.execute(
                select(LeadDelivery.bdc_agent_id, func.count())
                .where(
                    LeadDelivery.bdc_agent_id.in_(agent_ids),
                    LeadDelivery.partner_store_id == store_id,
                    LeadDelivery.status.in_(AGENT_OPEN_STATUSES),
                )
                .group_by(LeadDelivery.bdc_agent_id)
            )
        ).all()
    )
    open_agents = []
    for assignment, user in assignments:
        open_count = int(counts.get(user.id, 0))
        if open_count >= assignment.max_open_leads:
            continue
        open_agents.append((open_count, user.id))
    if not open_agents:
        return None
    open_agents.sort(key=lambda item: item[0])
    return open_agents[0][1]


async def assign_waiting_bdc_leads(db: AsyncSession, user_id: UUID) -> int:
    """Give this clocked-in agent the oldest unassigned full-BDC leads for their stores."""
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return 0
    open_entry = (
        await db.execute(
            select(TimeEntry.id).where(
                TimeEntry.user_id == user_id,
                TimeEntry.clock_out_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if open_entry is None:
        return 0

    assignments = list(
        (
            await db.execute(
                select(PartnerBdcAgent).where(PartnerBdcAgent.user_id == user_id)
            )
        ).scalars().all()
    )
    assigned = 0
    for assignment in assignments:
        open_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(LeadDelivery)
                    .where(
                        LeadDelivery.bdc_agent_id == user_id,
                        LeadDelivery.partner_store_id == assignment.partner_store_id,
                        LeadDelivery.status.in_(AGENT_OPEN_STATUSES),
                    )
                )
            ).scalar_one()
        )
        slots = assignment.max_open_leads - open_count
        if slots <= 0:
            continue
        waiting = list(
            (
                await db.execute(
                    select(LeadDelivery)
                    .where(
                        LeadDelivery.partner_store_id == assignment.partner_store_id,
                        LeadDelivery.program_type == PROGRAM_FULL_BDC,
                        LeadDelivery.bdc_agent_id.is_(None),
                        LeadDelivery.status == DELIVERY_DELIVERED,
                    )
                    .order_by(LeadDelivery.delivered_at.asc())
                    .limit(slots)
                )
            ).scalars().all()
        )
        for delivery in waiting:
            delivery.bdc_agent_id = user_id
            delivery.updated_at = utc_now()
            assigned += 1
    if assigned:
        await db.flush()
    return assigned


async def mark_delivery_appointment_set(
    db: AsyncSession,
    lead_id: UUID,
    partner_store_id: UUID,
    scheduled_at: datetime,
) -> Optional[LeadDelivery]:
    """Move the full-BDC delivery to appointment set and email the store once."""
    delivery = (
        await db.execute(
            select(LeadDelivery).where(
                LeadDelivery.lead_id == lead_id,
                LeadDelivery.partner_store_id == partner_store_id,
                LeadDelivery.program_type == PROGRAM_FULL_BDC,
                LeadDelivery.status.in_(LOCKING_STATUSES),
            )
        )
    ).scalar_one_or_none()
    if delivery is None:
        return None
    already = delivery.status == DELIVERY_APPOINTMENT_SET
    delivery.status = DELIVERY_APPOINTMENT_SET
    delivery.updated_at = utc_now()
    await db.flush()
    if not already:
        store = await db.get(PartnerStore, partner_store_id)
        lead = await db.get(Lead, lead_id)
        customer = await db.get(Customer, lead.customer_id) if lead else None
        when = scheduled_at.isoformat()
        name = _customer_name(customer) if customer else "A customer"
        if store is not None:
            await _email_store(
                store,
                subject=f"Appointment set at {store.name}",
                message=f"{name} is booked for {when}.",
            )
    return delivery


async def return_delivery(db: AsyncSession, delivery: LeadDelivery, note: Optional[str]) -> None:
    delivery.status = "returned"
    if note:
        delivery.note = note
    delivery.updated_at = utc_now()
    await db.flush()


async def run_partner_routing_retry() -> None:
    """Pick up leads that arrived while every matching store was closed or full."""
    from app.db.database import async_session_maker

    cutoff = utc_now() - timedelta(days=14)
    async with async_session_maker() as session:
        open_delivery = (
            select(LeadDelivery.id)
            .where(
                LeadDelivery.lead_id == Lead.id,
                LeadDelivery.status.in_(LOCKING_STATUSES),
            )
            .exists()
        )
        lead_ids = list(
            (
                await session.execute(
                    select(Lead.id)
                    .where(
                        Lead.is_active.is_(True),
                        Lead.created_at >= cutoff,
                        ~open_delivery,
                    )
                    .order_by(Lead.created_at.desc())
                    .limit(50)
                )
            ).scalars().all()
        )
        for lead_id in lead_ids:
            await route_lead_safely(session, lead_id)
        await session.commit()


async def _email_store(store: PartnerStore, subject: str, message: str) -> None:
    if not store.email:
        return
    try:
        from app.services.email_notifier import email_notifier

        await email_notifier.send_notification_email(
            to_email=store.email,
            to_name=store.contact_person or store.name,
            subject=subject,
            message=message,
            link="/partner",
        )
    except Exception:
        logger.exception("Partner email failed for store %s", store.id)


def _customer_name(customer: Optional[Customer]) -> str:
    if customer is None:
        return "A customer"
    name = f"{customer.first_name or ''} {customer.last_name or ''}".strip()
    return name or "A customer"
