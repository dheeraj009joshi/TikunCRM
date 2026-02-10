"""
Customer Service — find-or-create, deduplication, 360 view.
"""
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.customer import Customer
from app.models.lead import Lead

logger = logging.getLogger(__name__)


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """Strip non-digit chars (keep leading +)."""
    if not phone:
        return None
    cleaned = re.sub(r"[^\d+]", "", phone.strip())
    return cleaned or None


class CustomerService:
    """Service for customer deduplication and management."""

    @staticmethod
    async def find_or_create(
        db: AsyncSession,
        phone: Optional[str],
        email: Optional[str],
        first_name: str,
        last_name: Optional[str] = None,
        source: Optional[str] = None,
        **extra_fields: Any,
    ) -> Tuple[Customer, bool]:
        """
        Find existing customer by phone (priority) or email.
        If not found, create a new one.
        Returns (customer, was_created).
        """
        normalized_phone = normalize_phone(phone)
        existing: Optional[Customer] = None

        # Priority 1: match by phone
        if normalized_phone:
            result = await db.execute(
                select(Customer).where(Customer.phone == normalized_phone)
            )
            existing = result.scalar_one_or_none()

        # Priority 2: match by email
        if not existing and email:
            result = await db.execute(
                select(Customer).where(func.lower(Customer.email) == email.strip().lower())
            )
            existing = result.scalar_one_or_none()

        if existing:
            # Update any missing fields on the existing customer
            if not existing.phone and normalized_phone:
                existing.phone = normalized_phone
            if not existing.email and email:
                existing.email = email.strip().lower()
            if not existing.last_name and last_name:
                existing.last_name = last_name
            for field, value in extra_fields.items():
                if value is not None and hasattr(existing, field) and not getattr(existing, field):
                    setattr(existing, field, value)
            return existing, False

        # Create new customer
        customer = Customer(
            first_name=first_name,
            last_name=last_name,
            phone=normalized_phone,
            email=email.strip().lower() if email else None,
            source_first_touch=source,
            **{k: v for k, v in extra_fields.items() if v is not None and hasattr(Customer, k)},
        )
        db.add(customer)
        await db.flush()
        logger.info("Created new customer id=%s phone=%s email=%s", customer.id, normalized_phone, email)
        return customer, True

    @staticmethod
    async def get_customer(db: AsyncSession, customer_id: UUID) -> Optional[Customer]:
        result = await db.execute(select(Customer).where(Customer.id == customer_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def search_customers(
        db: AsyncSession,
        query: str,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[Customer], int]:
        """Search customers by name, phone, or email."""
        search = f"%{query}%"
        full_name = func.concat(Customer.first_name, " ", func.coalesce(Customer.last_name, ""))
        filters = or_(
            Customer.first_name.ilike(search),
            Customer.last_name.ilike(search),
            full_name.ilike(search),
            Customer.phone.ilike(search),
            Customer.email.ilike(search),
        )
        count_q = select(func.count()).select_from(Customer).where(filters)
        total = (await db.execute(count_q)).scalar() or 0

        items_q = (
            select(Customer)
            .where(filters)
            .order_by(Customer.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = (await db.execute(items_q)).scalars().all()
        return items, total

    @staticmethod
    async def list_customers(
        db: AsyncSession,
        page: int = 1,
        page_size: int = 20,
        search: Optional[str] = None,
    ) -> Tuple[List[Customer], int]:
        if search:
            return await CustomerService.search_customers(db, search, page, page_size)
        count_q = select(func.count()).select_from(Customer)
        total = (await db.execute(count_q)).scalar() or 0
        items_q = (
            select(Customer)
            .order_by(Customer.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = (await db.execute(items_q)).scalars().all()
        return items, total

    @staticmethod
    async def match_customers(
        db: AsyncSession,
        phone: Optional[str] = None,
        email: Optional[str] = None,
        limit: int = 5,
    ) -> List[Customer]:
        """
        Find customers matching phone (normalized, exact) or email (exact, case-insensitive).
        Name is not used for matching (lead name can vary). Returns up to `limit` distinct customers.
        """
        if not phone and not email:
            return []
        conditions = []
        normalized_phone = normalize_phone(phone)
        if normalized_phone:
            conditions.append(Customer.phone == normalized_phone)
        if email and email.strip():
            conditions.append(func.lower(Customer.email) == email.strip().lower())
        if not conditions:
            return []
        filter_or = or_(*conditions)
        q = (
            select(Customer)
            .where(filter_or)
            .order_by(Customer.created_at.desc())
            .limit(limit)
        )
        result = await db.execute(q)
        return list(result.scalars().unique().all())
