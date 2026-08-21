"""
Backfill lead filter fields from trust score, notes, meta_data, guests, and stips.

Updates:
  - Lead.down_payment
  - Lead.has_ssn_stip / Lead.has_dl_stip / Lead.is_business
  - Customer.has_license / Customer.credit_score (when found)
  - StipsCategory.filter_key for common ID-like categories

Usage (from backend/):
  .venv/bin/python -m scripts.backfill_lead_filter_flags
  .venv/bin/python -m scripts.backfill_lead_filter_flags --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import random
import re
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Optional, Set, Tuple
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.db.database import async_session_maker
from app.models.customer import Customer
from app.models.customer_stip_document import CustomerStipDocument
from app.models.eligibility import (
    EligibilityAssessment,
    EligibilityCriterion,
    EligibilityEntityType,
)
from app.models.guest import Guest
from app.models.lead import Lead
from app.models.lead_stip_document import LeadStipDocument
from app.models.stips_category import StipsCategory
from app.services.stip_flags_service import infer_filter_key, refresh_lead_stip_flags

DOWN_OPTION_MIDPOINT = {
    "5": 1500.0,
    "4": 2500.0,
    "3": 3500.0,
    "2": 4500.0,
    "1": 5500.0,
    "6": 6500.0,
}

DOWN_LABEL_MIDPOINT = {
    "1000-2000": 1500.0,
    "2000-3000": 2500.0,
    "3000-4000": 3500.0,
    "4000-5000": 4500.0,
    "5000-6000": 5500.0,
    "6000+": 6500.0,
}


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n != n:
        return None
    return n


def _parse_money_from_text(text: str) -> Optional[float]:
    if not text:
        return None
    t = text.lower()
    patterns = [
        r"down\s*(?:payment|pay|pmt)?\s*[:=]?\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*k\b",
        r"down\s*(?:payment|pay|pmt)?\s*[:=]?\s*\$?\s*(\d{3,6}(?:\.\d+)?)",
        r"\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:down|dp)\b",
        r"(\d{1,2})\s*k\s*(?:down|dp|downpayment)\b",
        r"(\d{4,5})\s*-\s*(\d{4,5}).{0,20}down",
    ]
    for pat in patterns:
        m = re.search(pat, t)
        if not m:
            continue
        if m.lastindex == 2:
            lo, hi = float(m.group(1).replace(",", "")), float(m.group(2).replace(",", ""))
            return (lo + hi) / 2.0
        raw = m.group(1).replace(",", "")
        n = float(raw)
        if "k" in m.group(0) and n < 100:
            n *= 1000
        if 100 <= n <= 100_000:
            return n
    return None


def _notes_has_ssn(text: str) -> bool:
    return bool(text and re.search(r"\bssn\b|social\s*security|tax\s*id|itin", text, re.I))


def _notes_has_dl(text: str) -> bool:
    return bool(
        text
        and re.search(
            r"\bdl\b|driver'?s?\s*licen[cs]e|\blicen[cs]e\b|\bhas\s+id\b|\bvalid\s+id\b",
            text,
            re.I,
        )
    )


def _down_from_assessment_value(value: Any, options: list) -> Optional[float]:
    if not value or not isinstance(value, dict):
        return None
    if value.get("number") is not None:
        n = _to_float(value["number"])
        if n is not None and n >= 100:
            return n
    opt = value.get("option")
    if opt is None:
        return None
    s = str(opt).strip()
    if s in DOWN_OPTION_MIDPOINT:
        return DOWN_OPTION_MIDPOINT[s]
    for o in options or []:
        if str(o.get("value")) == s:
            label = str(o.get("label") or "").strip()
            if label in DOWN_LABEL_MIDPOINT:
                return DOWN_LABEL_MIDPOINT[label]
            m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", label)
            if m:
                return (float(m.group(1)) + float(m.group(2))) / 2.0
            if label.endswith("+"):
                try:
                    return float(label[:-1]) + 500
                except ValueError:
                    pass
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", s)
    if m:
        return (float(m.group(1)) + float(m.group(2))) / 2.0
    n = _to_float(s)
    if n is not None and n >= 100:
        return n
    return None


def _bool_from_license_value(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, dict):
        if "boolean" in value:
            return bool(value["boolean"])
        opt = str(value.get("option") or "").strip().lower()
        if opt in ("y", "yes", "true", "1"):
            return True
        if opt in ("n", "no", "false", "0"):
            return False
    return None


def _bool_from_yes_no_option(value: Any) -> Optional[bool]:
    """Business / License style Yes(y) / No(n) selects."""
    if value is None:
        return None
    if isinstance(value, dict):
        if "boolean" in value:
            return bool(value["boolean"])
        opt = str(value.get("option") or "").strip().lower()
        if opt in ("y", "yes", "true", "1"):
            return True
        if opt in ("n", "no", "false", "0"):
            return False
    return None


def _finance_doc_on_file(value: Any) -> Optional[bool]:
    """Finance Document select: Passport / Tax ID / SSN (any one counts)."""
    if not isinstance(value, dict):
        return None
    opt = str(value.get("option") or "").strip().lower()
    # Codes + labels used in trust-score UI
    if opt in (
        "s",
        "ssn",
        "t",
        "tax id",
        "tax_id",
        "taxid",
        "p",
        "passport",
    ):
        return True
    return None


async def _commit_with_retry(db, dry_run: bool, label: str, attempts: int = 5) -> None:
    if dry_run:
        await db.rollback()
        print(f"   [{label}] dry-run — rolled back")
        return
    for i in range(attempts):
        try:
            await db.commit()
            print(f"   [{label}] committed")
            return
        except Exception as e:
            msg = str(e).lower()
            await db.rollback()
            if "deadlock" not in msg or i == attempts - 1:
                raise
            wait = 0.4 * (2**i) + random.random() * 0.3
            print(f"   [{label}] deadlock — retry {i + 1}/{attempts} in {wait:.1f}s")
            await asyncio.sleep(wait)


async def backfill_category_filter_keys(dry_run: bool) -> int:
    async with async_session_maker() as db:
        cats = (await db.execute(select(StipsCategory))).scalars().all()
        updated = 0
        for cat in cats:
            if cat.filter_key:
                continue
            inferred = infer_filter_key(cat.name, None)
            if not inferred and re.fullmatch(
                r"id|photo\s*id|state\s*id", (cat.name or "").strip(), re.I
            ):
                inferred = "dl"
            if not inferred:
                continue
            print(f"  category '{cat.name}' → filter_key={inferred}")
            cat.filter_key = inferred
            updated += 1
        await _commit_with_retry(db, dry_run, "categories")
        return updated


async def refresh_stip_flags_from_docs(dry_run: bool) -> int:
    """Bulk-set stip flags from docs + category filter_key (avoids N+1 latency)."""
    from sqlalchemy import text

    async with async_session_maker() as db:
        if dry_run:
            n = (
                await db.execute(
                    text(
                        """
                        SELECT COUNT(DISTINCT lead_id) FROM (
                          SELECT lsd.lead_id
                          FROM lead_stip_documents lsd
                          JOIN stips_categories sc ON sc.id = lsd.stips_category_id
                          WHERE sc.filter_key IN ('ssn','dl')
                          UNION
                          SELECT l.id
                          FROM leads l
                          JOIN customer_stip_documents csd
                            ON csd.customer_id IN (l.customer_id, l.secondary_customer_id)
                          JOIN stips_categories sc ON sc.id = csd.stips_category_id
                          WHERE sc.filter_key IN ('ssn','dl')
                        ) t
                        """
                    )
                )
            ).scalar() or 0
            print(f"   leads that would get doc-based flags: {n}", flush=True)
            return int(n)

        await db.execute(
            text(
                """
                UPDATE leads SET has_dl_stip = true, updated_at = NOW()
                WHERE id IN (
                  SELECT DISTINCT lsd.lead_id
                  FROM lead_stip_documents lsd
                  JOIN stips_categories sc ON sc.id = lsd.stips_category_id
                  WHERE sc.filter_key = 'dl'
                )
                AND has_dl_stip IS DISTINCT FROM true
                """
            )
        )
        await db.execute(
            text(
                """
                UPDATE leads SET has_ssn_stip = true, updated_at = NOW()
                WHERE id IN (
                  SELECT DISTINCT lsd.lead_id
                  FROM lead_stip_documents lsd
                  JOIN stips_categories sc ON sc.id = lsd.stips_category_id
                  WHERE sc.filter_key = 'ssn'
                )
                AND has_ssn_stip IS DISTINCT FROM true
                """
            )
        )
        await db.execute(
            text(
                """
                UPDATE leads SET has_dl_stip = true, updated_at = NOW()
                WHERE id IN (
                  SELECT DISTINCT l.id
                  FROM leads l
                  JOIN customer_stip_documents csd
                    ON csd.customer_id IN (l.customer_id, l.secondary_customer_id)
                  JOIN stips_categories sc ON sc.id = csd.stips_category_id
                  WHERE sc.filter_key = 'dl'
                )
                AND has_dl_stip IS DISTINCT FROM true
                """
            )
        )
        await db.execute(
            text(
                """
                UPDATE leads SET has_ssn_stip = true, updated_at = NOW()
                WHERE id IN (
                  SELECT DISTINCT l.id
                  FROM leads l
                  JOIN customer_stip_documents csd
                    ON csd.customer_id IN (l.customer_id, l.secondary_customer_id)
                  JOIN stips_categories sc ON sc.id = csd.stips_category_id
                  WHERE sc.filter_key = 'ssn'
                )
                AND has_ssn_stip IS DISTINCT FROM true
                """
            )
        )
        await db.execute(
            text(
                """
                UPDATE customers c SET has_license = true
                FROM leads l
                WHERE l.customer_id = c.id
                  AND l.has_dl_stip = true
                  AND (c.has_license IS DISTINCT FROM true)
                """
            )
        )
        await _commit_with_retry(db, dry_run=False, label="stip-refresh-bulk")
        return 0


def _merge_lead_patch(
    patches: Dict[UUID, Dict[str, Any]],
    lead_id: UUID,
    *,
    down: Optional[float] = None,
    ssn: Optional[bool] = None,
    dl: Optional[bool] = None,
    is_business: Optional[bool] = None,
) -> None:
    p = patches.setdefault(lead_id, {})
    if down is not None and down >= 100:
        cur = p.get("down_payment")
        if cur is None:
            p["down_payment"] = Decimal(str(round(down, 2)))
    if ssn is True:
        p["has_ssn_stip"] = True
    if dl is True:
        p["has_dl_stip"] = True
    if is_business is not None:
        p["is_business"] = is_business


async def collect_assessment_patches(
    db,
) -> Tuple[Dict[UUID, Dict[str, Any]], Dict[UUID, Dict[str, Any]], Dict[UUID, Dict[str, Any]]]:
    """Return (lead_patches, guest_patches, customer_patches)."""
    criteria = {
        c.id: c
        for c in (await db.execute(select(EligibilityCriterion))).scalars().all()
    }
    assessments = (
        await db.execute(
            select(EligibilityAssessment).options(selectinload(EligibilityAssessment.items))
        )
    ).scalars().all()

    lead_ids = [
        a.entity_id for a in assessments if a.entity_type == EligibilityEntityType.LEAD.value
    ]
    guest_ids = [
        a.entity_id for a in assessments if a.entity_type == EligibilityEntityType.GUEST.value
    ]

    leads_map: Dict[UUID, Lead] = {}
    if lead_ids:
        res = await db.execute(select(Lead).where(Lead.id.in_(lead_ids)))
        leads_map = {l.id: l for l in res.scalars().all()}

    guests_map: Dict[UUID, Guest] = {}
    if guest_ids:
        res = await db.execute(select(Guest).where(Guest.id.in_(guest_ids)))
        guests_map = {g.id: g for g in res.scalars().all()}
        linked = [g.lead_id for g in guests_map.values() if g.lead_id]
        if linked:
            res = await db.execute(select(Lead).where(Lead.id.in_(linked)))
            for l in res.scalars().all():
                leads_map[l.id] = l

    cust_ids = {l.customer_id for l in leads_map.values() if l.customer_id}
    cust_ids |= {g.customer_id for g in guests_map.values() if g.customer_id}
    customers: Dict[UUID, Customer] = {}
    if cust_ids:
        res = await db.execute(select(Customer).where(Customer.id.in_(cust_ids)))
        customers = {c.id: c for c in res.scalars().all()}

    lead_patches: Dict[UUID, Dict[str, Any]] = {}
    guest_patches: Dict[UUID, Dict[str, Any]] = {}
    cust_patches: Dict[UUID, Dict[str, Any]] = {}

    for a in assessments:
        lead: Optional[Lead] = None
        guest: Optional[Guest] = None
        if a.entity_type == EligibilityEntityType.LEAD.value:
            lead = leads_map.get(a.entity_id)
        elif a.entity_type == EligibilityEntityType.GUEST.value:
            guest = guests_map.get(a.entity_id)
            if guest and guest.lead_id:
                lead = leads_map.get(guest.lead_id)

        for item in a.items or []:
            crit = criteria.get(item.criterion_id)
            if not crit:
                continue
            label = (crit.label or "").lower()
            key = (crit.auto_field or crit.key or "").lower()
            options = (crit.config or {}).get("options") or []

            if key in ("down_payment", "downpayment", "has_downpayment") or "down" in label:
                amount = _down_from_assessment_value(item.value, options)
                if amount is not None:
                    if lead and (lead.down_payment is None or float(lead.down_payment) < 100):
                        _merge_lead_patch(lead_patches, lead.id, down=amount)
                    if guest and (guest.down_payment is None or float(guest.down_payment) < 100):
                        guest_patches.setdefault(guest.id, {})["down_payment"] = Decimal(
                            str(round(amount, 2))
                        )

            if key in ("has_license", "liscense", "license") or "license" in label:
                if _bool_from_license_value(item.value) is True and lead:
                    if not lead.has_dl_stip:
                        _merge_lead_patch(lead_patches, lead.id, dl=True)
                    cust = customers.get(lead.customer_id) if lead.customer_id else None
                    if cust and cust.has_license is not True:
                        cust_patches.setdefault(cust.id, {})["has_license"] = True

            if key in ("business", "is_business") or label.strip() == "business":
                flag = _bool_from_yes_no_option(item.value)
                if flag is not None and lead and lead.is_business is None:
                    _merge_lead_patch(lead_patches, lead.id, is_business=flag)

            if "finance" in label or "ssn" in label or key == "finance_document":
                if _finance_doc_on_file(item.value) and lead and not lead.has_ssn_stip:
                    _merge_lead_patch(lead_patches, lead.id, ssn=True)

            if key == "credit_score" or "credit" in label:
                if isinstance(item.value, dict) and item.value.get("number") is not None:
                    score = _to_float(item.value["number"])
                    if score is not None and score > 0 and lead and lead.customer_id:
                        cust = customers.get(lead.customer_id)
                        if cust and not cust.credit_score:
                            cust_patches.setdefault(cust.id, {})["credit_score"] = int(score)

    return lead_patches, guest_patches, cust_patches


async def collect_meta_note_patches(db) -> Dict[UUID, Dict[str, Any]]:
    leads = (await db.execute(select(Lead))).scalars().all()
    guest_rows = (
        await db.execute(select(Guest).where(Guest.lead_id.isnot(None)))
    ).scalars().all()
    guest_by_lead = {g.lead_id: g for g in guest_rows if g.lead_id}

    patches: Dict[UUID, Dict[str, Any]] = {}
    for lead in leads:
        guest = guest_by_lead.get(lead.id)
        if guest and guest.down_payment is not None and float(guest.down_payment) >= 100:
            if lead.down_payment is None or float(lead.down_payment) < 100:
                _merge_lead_patch(patches, lead.id, down=float(guest.down_payment))

        meta = lead.meta_data or {}
        amount = _to_float(meta.get("downpayment") or meta.get("down_payment"))
        if amount is not None and amount >= 100:
            if lead.down_payment is None or float(lead.down_payment) < 100:
                _merge_lead_patch(patches, lead.id, down=amount)

        notes = lead.notes or ""
        note_amount = _parse_money_from_text(notes)
        if note_amount is not None:
            if lead.down_payment is None or float(lead.down_payment) < 100:
                _merge_lead_patch(patches, lead.id, down=note_amount)

        if _notes_has_ssn(notes) and not lead.has_ssn_stip:
            _merge_lead_patch(patches, lead.id, ssn=True)
        if _notes_has_dl(notes) and not lead.has_dl_stip:
            _merge_lead_patch(patches, lead.id, dl=True)

        if lead.is_business is None and re.search(
            r"\bis\s+a\s+business\b|\bbusiness\s+(customer|owner|account)\b|\bllc\b|\binc\.?\b",
            notes,
            re.I,
        ):
            _merge_lead_patch(patches, lead.id, is_business=True)

    return patches


async def apply_lead_patches(
    patches: Dict[UUID, Dict[str, Any]], dry_run: bool, label: str, batch_size: int = 200
) -> Dict[str, int]:
    stats = {"down": 0, "ssn": 0, "dl": 0, "business": 0, "rows": 0}
    for p in patches.values():
        if "down_payment" in p:
            stats["down"] += 1
        if p.get("has_ssn_stip"):
            stats["ssn"] += 1
        if p.get("has_dl_stip"):
            stats["dl"] += 1
        if "is_business" in p:
            stats["business"] += 1
    stats["rows"] = len(patches)
    print(
        f"   {label}: rows={stats['rows']} down={stats['down']} "
        f"ssn={stats['ssn']} dl={stats['dl']} business={stats['business']}",
        flush=True,
    )
    if dry_run or not patches:
        return stats

    ids = sorted(patches.keys(), key=str)
    for attempt in range(5):
        try:
            async with async_session_maker() as db:
                for i, lid in enumerate(ids):
                    await db.execute(
                        update(Lead).where(Lead.id == lid).values(**patches[lid])
                    )
                    if (i + 1) % batch_size == 0:
                        await db.flush()
                        print(f"  … flushed {i + 1}/{len(ids)}", flush=True)
                await db.commit()
            print(f"  … committed {len(ids)}", flush=True)
            break
        except Exception as e:
            if "deadlock" not in str(e).lower() or attempt == 4:
                raise
            await asyncio.sleep(0.5 * (2**attempt) + random.random() * 0.3)
            print(f"   [{label}] deadlock — retry {attempt + 1}", flush=True)
    return stats


async def apply_simple_patches(
    model,
    patches: Dict[UUID, Dict[str, Any]],
    dry_run: bool,
    label: str,
) -> int:
    print(f"   {label}: rows={len(patches)}")
    if dry_run or not patches:
        return len(patches)
    ids = sorted(patches.keys(), key=str)
    for i in range(0, len(ids), 40):
        chunk = ids[i : i + 40]
        for attempt in range(5):
            try:
                async with async_session_maker() as db:
                    for oid in chunk:
                        await db.execute(
                            update(model).where(model.id == oid).values(**patches[oid])
                        )
                    await db.commit()
                break
            except Exception as e:
                if "deadlock" not in str(e).lower() or attempt == 4:
                    raise
                await asyncio.sleep(0.4 * (2**attempt) + random.random() * 0.3)
    return len(patches)


async def print_summary() -> None:
    from sqlalchemy import func

    async with async_session_maker() as db:
        total = (await db.execute(select(func.count()).select_from(Lead))).scalar()
        ssn = (
            await db.execute(
                select(func.count()).select_from(Lead).where(Lead.has_ssn_stip.is_(True))
            )
        ).scalar()
        dl = (
            await db.execute(
                select(func.count()).select_from(Lead).where(Lead.has_dl_stip.is_(True))
            )
        ).scalar()
        both = (
            await db.execute(
                select(func.count())
                .select_from(Lead)
                .where(Lead.has_ssn_stip.is_(True), Lead.has_dl_stip.is_(True))
            )
        ).scalar()
        with_dp = (
            await db.execute(
                select(func.count()).select_from(Lead).where(Lead.down_payment.isnot(None))
            )
        ).scalar()
        biz_y = (
            await db.execute(
                select(func.count()).select_from(Lead).where(Lead.is_business.is_(True))
            )
        ).scalar()
        biz_n = (
            await db.execute(
                select(func.count()).select_from(Lead).where(Lead.is_business.is_(False))
            )
        ).scalar()
        in_range = (
            await db.execute(
                select(func.count())
                .select_from(Lead)
                .where(
                    Lead.has_ssn_stip.is_(True),
                    Lead.has_dl_stip.is_(True),
                    Lead.down_payment >= 2000,
                    Lead.down_payment <= 3000,
                )
            )
        ).scalar()
        print(
            "Summary:",
            {
                "total": total,
                "has_ssn_stip": ssn,
                "has_dl_stip": dl,
                "both_stips": both,
                "with_down_payment": with_dp,
                "is_business_yes": biz_y,
                "is_business_no": biz_n,
                "ssn+dl+down_2k_3k": in_range,
            },
        )


async def run(dry_run: bool) -> None:
    print(f"{'DRY RUN — ' if dry_run else ''}Backfilling lead filter fields…")

    print("1) Stips category filter_key mapping")
    cat_n = await backfill_category_filter_keys(dry_run)
    print(f"   categories updated: {cat_n}")

    print("2) Refresh stip flags from uploaded documents")
    stip_n = await refresh_stip_flags_from_docs(dry_run)
    print(f"   leads refreshed: {stip_n}")

    print("3) Trust-score assessments → patches")
    async with async_session_maker() as db:
        lead_a, guest_a, cust_a = await collect_assessment_patches(db)
    await apply_lead_patches(lead_a, dry_run, "assessment leads")
    await apply_simple_patches(Guest, guest_a, dry_run, "assessment guests")
    await apply_simple_patches(Customer, cust_a, dry_run, "assessment customers")

    print("4) Meta / guest / notes → patches")
    async with async_session_maker() as db:
        lead_m = await collect_meta_note_patches(db)
    # Don't overwrite assessment down with weaker data: merge only missing fields
    # Re-read current lead state for flags already set
    if not dry_run and lead_m:
        async with async_session_maker() as db:
            existing = (
                await db.execute(
                    select(
                        Lead.id,
                        Lead.down_payment,
                        Lead.has_ssn_stip,
                        Lead.has_dl_stip,
                        Lead.is_business,
                    ).where(Lead.id.in_(list(lead_m.keys())))
                )
            ).all()
            by_id = {r[0]: r for r in existing}
        cleaned: Dict[UUID, Dict[str, Any]] = {}
        for lid, patch in lead_m.items():
            row = by_id.get(lid)
            if not row:
                continue
            _, down, has_ssn, has_dl, is_biz = row
            out: Dict[str, Any] = {}
            if "down_payment" in patch and (down is None or float(down) < 100):
                out["down_payment"] = patch["down_payment"]
            if patch.get("has_ssn_stip") and not has_ssn:
                out["has_ssn_stip"] = True
            if patch.get("has_dl_stip") and not has_dl:
                out["has_dl_stip"] = True
            if "is_business" in patch and is_biz is None:
                out["is_business"] = patch["is_business"]
            if out:
                cleaned[lid] = out
        lead_m = cleaned
    await apply_lead_patches(lead_m, dry_run, "meta/notes leads")

    await print_summary()
    if dry_run:
        print("Dry-run complete (no durable writes except none).")
    else:
        print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and print without committing",
    )
    args = parser.parse_args()
    asyncio.run(run(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
