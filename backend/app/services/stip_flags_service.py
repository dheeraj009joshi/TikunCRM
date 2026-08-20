"""
Sync lead stip presence flags from uploaded documents + category filter_key.
"""
from __future__ import annotations

import re
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer_stip_document import CustomerStipDocument
from app.models.lead import Lead
from app.models.lead_stip_document import LeadStipDocument
from app.models.stips_category import StipsCategory


def infer_filter_key(name: Optional[str], explicit: Optional[str] = None) -> Optional[str]:
    """Resolve filter_key from category setting or name heuristics."""
    if explicit:
        key = explicit.strip().lower()
        if key in ("ssn", "dl"):
            return key
    n = (name or "").lower()
    if re.search(r"\bssn\b|social\s*security|tax\s*id|itin", n):
        return "ssn"
    if re.search(r"\bdl\b|driver'?s?\s*licen[cs]e|\blicen[cs]e\b", n):
        return "dl"
    return None


async def refresh_lead_stip_flags(db: AsyncSession, lead_id: UUID) -> None:
    """Recompute has_ssn_stip / has_dl_stip for a lead from current documents."""
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        return

    keys: set[str] = set()

    # Lead-scoped docs
    lead_rows = await db.execute(
        select(StipsCategory)
        .join(LeadStipDocument, LeadStipDocument.stips_category_id == StipsCategory.id)
        .where(LeadStipDocument.lead_id == lead_id)
    )
    for cat in lead_rows.scalars().all():
        k = infer_filter_key(cat.name, cat.filter_key)
        if k:
            keys.add(k)

    # Customer-scoped docs (primary + secondary)
    customer_ids = [cid for cid in (lead.customer_id, lead.secondary_customer_id) if cid]
    if customer_ids:
        cust_rows = await db.execute(
            select(StipsCategory)
            .join(
                CustomerStipDocument,
                CustomerStipDocument.stips_category_id == StipsCategory.id,
            )
            .where(CustomerStipDocument.customer_id.in_(customer_ids))
        )
        for cat in cust_rows.scalars().all():
            k = infer_filter_key(cat.name, cat.filter_key)
            if k:
                keys.add(k)

    lead.has_ssn_stip = "ssn" in keys
    lead.has_dl_stip = "dl" in keys

    # Mirror DL stip → customer.has_license when we have a clear DL document
    if lead.has_dl_stip and lead.customer_id:
        from app.models.customer import Customer

        cres = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
        cust = cres.scalar_one_or_none()
        if cust and cust.has_license is not True:
            cust.has_license = True

    await db.flush()
