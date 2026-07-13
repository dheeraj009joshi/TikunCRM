"""
Eligibility (Trust) Score engine.

Scoring rules per criterion input_type:
- boolean:           points = weight if met else 0
- number/threshold:  points = weight if value satisfies operator vs threshold else 0
- number/scaled:     points = weight * clamp((value-min)/(max-min), 0, 1)  (inverted for lower_better)
- select:            points = weight * selected_option.fraction

`auto` criteria evaluate from entity data unless an item is marked is_override.
total_score = round(sum(points) / sum(active weights) * 100, 2)
"""
import logging
import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.models.eligibility import (
    EligibilityAssessment,
    EligibilityAssessmentItem,
    EligibilityCriterion,
    EligibilityEntityType,
    EligibilityInputType,
    EligibilityValueSource,
)

logger = logging.getLogger(__name__)


def _slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")
    return s or "criterion"


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


class EligibilityService:
    # Auto fields the engine knows how to resolve from entity data.
    AUTO_FIELDS = ["down_payment", "credit_score", "has_license", "distance_miles"]

    # ---------------- Criteria CRUD ----------------

    @staticmethod
    async def list_criteria(
        db: AsyncSession,
        dealership_id: Optional[UUID],
        active_only: bool = False,
        include_global: bool = True,
    ) -> List[EligibilityCriterion]:
        """List criteria for a dealership.

        By default also includes *global* criteria (dealership_id IS NULL), which
        act as defaults that apply to every dealership unless overridden.
        """
        stmt = select(EligibilityCriterion)
        if dealership_id is not None:
            if include_global:
                stmt = stmt.where(
                    (EligibilityCriterion.dealership_id == dealership_id)
                    | (EligibilityCriterion.dealership_id.is_(None))
                )
            else:
                stmt = stmt.where(EligibilityCriterion.dealership_id == dealership_id)
        else:
            # No dealership context → only the global criteria.
            stmt = stmt.where(EligibilityCriterion.dealership_id.is_(None))
        if active_only:
            stmt = stmt.where(EligibilityCriterion.is_active == True)  # noqa: E712
        stmt = stmt.order_by(
            EligibilityCriterion.display_order, EligibilityCriterion.created_at
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_criterion(db: AsyncSession, criterion_id: UUID) -> Optional[EligibilityCriterion]:
        result = await db.execute(
            select(EligibilityCriterion).where(EligibilityCriterion.id == criterion_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def create_criterion(db: AsyncSession, data: dict) -> EligibilityCriterion:
        if not data.get("key"):
            data["key"] = _slugify(data.get("label", ""))
        criterion = EligibilityCriterion(**data)
        db.add(criterion)
        await db.flush()
        return criterion

    @staticmethod
    async def reorder(db: AsyncSession, ordered_ids: List[UUID]) -> None:
        for index, cid in enumerate(ordered_ids):
            crit = await EligibilityService.get_criterion(db, cid)
            if crit:
                crit.display_order = index

    # ---------------- Scoring ----------------

    @staticmethod
    def _resolved_value_for_item(
        criterion: EligibilityCriterion,
        item: Optional[EligibilityAssessmentItem],
        auto_value: Any,
    ) -> Tuple[bool, Optional[dict], Decimal]:
        """Return (is_met, stored_value, points) for one criterion."""
        weight = Decimal(criterion.weight or 0)
        config = criterion.config or {}
        is_auto = criterion.value_source == EligibilityValueSource.AUTO.value
        use_stored = (not is_auto) or (item is not None and item.is_override)

        if criterion.input_type == EligibilityInputType.BOOLEAN.value:
            if use_stored:
                met = bool(item.is_met) if item else False
            else:
                met = bool(auto_value)
            return met, (item.value if item else None), (weight if met else Decimal(0))

        if criterion.input_type == EligibilityInputType.NUMBER.value:
            if use_stored and item and item.value is not None:
                num = _to_float(item.value.get("number"))
            else:
                num = _to_float(auto_value)
            stored_val = item.value if item else None
            if num is None:
                return False, stored_val, Decimal(0)
            method = config.get("method", "threshold")
            if method == "scaled":
                lo = _to_float(config.get("min")) or 0.0
                hi = _to_float(config.get("max"))
                if hi is None or hi == lo:
                    frac = 1.0 if num >= lo else 0.0
                else:
                    frac = _clamp((num - lo) / (hi - lo))
                if config.get("direction", "higher_better") == "lower_better":
                    frac = 1.0 - frac
                pts = (weight * Decimal(str(frac))).quantize(Decimal("0.01"))
                return frac > 0, stored_val, pts
            # threshold
            operator = config.get("operator", "gte")
            threshold = _to_float(config.get("threshold"))
            if threshold is None:
                return False, stored_val, Decimal(0)
            ok = {
                "gte": num >= threshold,
                "lte": num <= threshold,
                "gt": num > threshold,
                "lt": num < threshold,
                "eq": num == threshold,
            }.get(operator, num >= threshold)
            return ok, stored_val, (weight if ok else Decimal(0))

        if criterion.input_type == EligibilityInputType.SELECT.value:
            options = config.get("options", []) or []
            selected = None
            if use_stored and item and item.value is not None:
                selected = item.value.get("option")
            elif not use_stored:
                selected = auto_value
            stored_val = item.value if item else None
            if selected is None:
                return False, stored_val, Decimal(0)
            match = next((o for o in options if str(o.get("value")) == str(selected)), None)
            if not match:
                return False, stored_val, Decimal(0)
            frac = _to_float(match.get("fraction"))
            frac = 0.0 if frac is None else _clamp(frac)
            pts = (weight * Decimal(str(frac))).quantize(Decimal("0.01"))
            return frac > 0, stored_val, pts

        return False, (item.value if item else None), Decimal(0)

    @staticmethod
    async def _resolve_entity_auto_values(
        db: AsyncSession, entity_type: str, entity_id: UUID
    ) -> Tuple[Dict[str, Any], Optional[UUID]]:
        """Build a dict of auto_field -> value for an entity. Returns (values, dealership_id)."""
        values: Dict[str, Any] = {}
        dealership_id: Optional[UUID] = None

        if entity_type == EligibilityEntityType.LEAD.value:
            from app.models.lead import Lead
            res = await db.execute(select(Lead).where(Lead.id == entity_id))
            lead = res.scalar_one_or_none()
            if lead:
                dealership_id = lead.dealership_id
                dp = lead.down_payment
                if dp is None:
                    dp = (lead.meta_data or {}).get("downpayment") or (lead.meta_data or {}).get("down_payment")
                values["down_payment"] = _to_float(dp)
                cust = lead.customer
                if cust:
                    values["credit_score"] = cust.credit_score
                    values["has_license"] = cust.has_license

        elif entity_type == EligibilityEntityType.CUSTOMER.value:
            from app.models.customer import Customer
            res = await db.execute(select(Customer).where(Customer.id == entity_id))
            cust = res.scalar_one_or_none()
            if cust:
                values["credit_score"] = cust.credit_score
                values["has_license"] = cust.has_license

        elif entity_type == EligibilityEntityType.GUEST.value:
            from app.models.guest import Guest
            res = await db.execute(select(Guest).where(Guest.id == entity_id))
            guest = res.scalar_one_or_none()
            if guest:
                dealership_id = guest.dealership_id
                values["down_payment"] = _to_float(guest.down_payment)
                if guest.customer_id:
                    from app.models.customer import Customer
                    cres = await db.execute(select(Customer).where(Customer.id == guest.customer_id))
                    cust = cres.scalar_one_or_none()
                    if cust:
                        values["credit_score"] = cust.credit_score
                        values["has_license"] = cust.has_license

        return values, dealership_id

    @staticmethod
    async def _get_linked_lead_guest(
        db: AsyncSession, entity_type: str, entity_id: UUID
    ) -> Optional[Tuple[str, UUID]]:
        """Return the linked lead↔guest counterpart as (entity_type, entity_id), if any."""
        from app.models.guest import Guest

        if entity_type == EligibilityEntityType.GUEST.value:
            res = await db.execute(select(Guest).where(Guest.id == entity_id).limit(1))
            guest = res.scalar_one_or_none()
            if guest and guest.lead_id:
                return (EligibilityEntityType.LEAD.value, guest.lead_id)
            return None

        if entity_type == EligibilityEntityType.LEAD.value:
            res = await db.execute(
                select(Guest)
                .where(Guest.lead_id == entity_id)
                .order_by(Guest.created_at.asc())
                .limit(1)
            )
            guest = res.scalar_one_or_none()
            if guest:
                return (EligibilityEntityType.GUEST.value, guest.id)
            return None

        return None

    @staticmethod
    def _item_is_substantive(item: EligibilityAssessmentItem) -> bool:
        """True if the item looks user-filled (not just an empty auto baseline)."""
        if item.value is not None:
            return True
        if item.is_override:
            return True
        if item.checked_at is not None:
            return True
        return False

    @staticmethod
    async def _assessment_has_substantive_items(
        db: AsyncSession, assessment_id: UUID
    ) -> bool:
        res = await db.execute(
            select(EligibilityAssessmentItem).where(
                EligibilityAssessmentItem.assessment_id == assessment_id
            )
        )
        return any(
            EligibilityService._item_is_substantive(item)
            for item in res.scalars().all()
        )

    @staticmethod
    async def _copy_assessment_items(
        db: AsyncSession,
        source: EligibilityAssessment,
        target: EligibilityAssessment,
        user_id: Optional[UUID] = None,
    ) -> None:
        """Copy criterion responses from source assessment onto target (upsert)."""
        src_res = await db.execute(
            select(EligibilityAssessmentItem).where(
                EligibilityAssessmentItem.assessment_id == source.id
            )
        )
        src_items = list(src_res.scalars().all())
        if not src_items:
            return

        tgt_res = await db.execute(
            select(EligibilityAssessmentItem).where(
                EligibilityAssessmentItem.assessment_id == target.id
            )
        )
        tgt_by_crit = {item.criterion_id: item for item in tgt_res.scalars().all()}

        for src in src_items:
            tgt = tgt_by_crit.get(src.criterion_id)
            if tgt is None:
                tgt = EligibilityAssessmentItem(
                    assessment_id=target.id,
                    criterion_id=src.criterion_id,
                )
                db.add(tgt)
            tgt.is_met = src.is_met
            tgt.value = src.value
            tgt.is_override = src.is_override
            tgt.points = src.points
            tgt.checked_by = src.checked_by or user_id
            tgt.checked_at = src.checked_at or utc_now()

        target.raw_points = source.raw_points
        target.max_points = source.max_points
        target.total_score = source.total_score
        target.last_updated_by = user_id or source.last_updated_by
        await db.flush()

    @staticmethod
    async def ensure_lead_guest_assessment_sync(
        db: AsyncSession,
        entity_type: str,
        entity_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> None:
        """
        Keep lead and guest trust scores aligned.

        If one side has filled criteria and the other does not, copy filled → empty.
        If both are filled but scores differ, prefer the more recently updated side.
        """
        linked = await EligibilityService._get_linked_lead_guest(db, entity_type, entity_id)
        if not linked:
            return

        other_type, other_id = linked
        _, dealership_a = await EligibilityService._resolve_entity_auto_values(
            db, entity_type, entity_id
        )
        _, dealership_b = await EligibilityService._resolve_entity_auto_values(
            db, other_type, other_id
        )

        a = await EligibilityService.get_or_create_assessment(
            db, entity_type, entity_id, dealership_a
        )
        b = await EligibilityService.get_or_create_assessment(
            db, other_type, other_id, dealership_b or dealership_a
        )

        a_filled = await EligibilityService._assessment_has_substantive_items(db, a.id)
        b_filled = await EligibilityService._assessment_has_substantive_items(db, b.id)

        if a_filled and not b_filled:
            await EligibilityService._copy_assessment_items(db, a, b, user_id=user_id)
        elif b_filled and not a_filled:
            await EligibilityService._copy_assessment_items(db, b, a, user_id=user_id)

    @staticmethod
    async def get_or_create_assessment(
        db: AsyncSession,
        entity_type: str,
        entity_id: UUID,
        dealership_id: Optional[UUID],
    ) -> EligibilityAssessment:
        res = await db.execute(
            select(EligibilityAssessment).where(
                EligibilityAssessment.entity_type == entity_type,
                EligibilityAssessment.entity_id == entity_id,
            )
        )
        assessment = res.scalar_one_or_none()
        if assessment is None:
            assessment = EligibilityAssessment(
                entity_type=entity_type,
                entity_id=entity_id,
                dealership_id=dealership_id,
            )
            db.add(assessment)
            await db.flush()
        elif dealership_id and not assessment.dealership_id:
            assessment.dealership_id = dealership_id
        return assessment

    @staticmethod
    async def build_assessment_payload(
        db: AsyncSession,
        entity_type: str,
        entity_id: UUID,
        dealership_id: Optional[UUID] = None,
    ) -> dict:
        """Compute (and persist) the full assessment payload for an entity."""
        # Align lead ↔ guest so Trust Score tab and Guest Trust badge share one score
        if entity_type in (
            EligibilityEntityType.LEAD.value,
            EligibilityEntityType.GUEST.value,
        ):
            await EligibilityService.ensure_lead_guest_assessment_sync(
                db, entity_type, entity_id
            )

        auto_values, resolved_dealership = await EligibilityService._resolve_entity_auto_values(
            db, entity_type, entity_id
        )
        dealership_id = dealership_id or resolved_dealership

        assessment = await EligibilityService.get_or_create_assessment(
            db, entity_type, entity_id, dealership_id
        )

        criteria = await EligibilityService.list_criteria(
            db, assessment.dealership_id, active_only=True
        )

        # Query items directly (avoids a stale relationship cache after writes)
        items_res = await db.execute(
            select(EligibilityAssessmentItem).where(
                EligibilityAssessmentItem.assessment_id == assessment.id
            )
        )
        items_by_criterion = {item.criterion_id: item for item in items_res.scalars().all()}

        payload_items: List[dict] = []
        raw_points = Decimal(0)
        max_points = Decimal(0)

        for crit in criteria:
            item = items_by_criterion.get(crit.id)
            auto_value = auto_values.get(crit.auto_field) if crit.auto_field else None
            met, stored_value, points = EligibilityService._resolved_value_for_item(
                crit, item, auto_value
            )

            # Persist computed points (and create a baseline item for auto criteria)
            if item is None and crit.value_source == EligibilityValueSource.AUTO.value:
                item = EligibilityAssessmentItem(
                    assessment_id=assessment.id,
                    criterion_id=crit.id,
                    is_met=met,
                    value=stored_value,
                    is_override=False,
                    points=points,
                )
                db.add(item)
            elif item is not None:
                item.is_met = met
                item.points = points

            raw_points += points
            max_points += Decimal(crit.weight or 0)

            payload_items.append({
                "criterion_id": crit.id,
                "label": crit.label,
                "description": crit.description,
                "category": crit.category,
                "input_type": crit.input_type,
                "value_source": crit.value_source,
                "auto_field": crit.auto_field,
                "config": crit.config or {},
                "weight": Decimal(crit.weight or 0),
                "display_order": crit.display_order,
                "is_met": met,
                "value": stored_value,
                "is_override": bool(item.is_override) if item else False,
                "points": points,
                "auto_value": auto_value,
            })

        total = Decimal(0)
        if max_points > 0:
            total = (raw_points / max_points * Decimal(100)).quantize(Decimal("0.01"))

        assessment.raw_points = raw_points
        assessment.max_points = max_points
        assessment.total_score = total
        await db.flush()

        return {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "dealership_id": assessment.dealership_id,
            "total_score": total,
            "raw_points": raw_points,
            "max_points": max_points,
            "items": payload_items,
            "updated_at": assessment.updated_at,
        }

    @staticmethod
    async def set_item(
        db: AsyncSession,
        entity_type: str,
        entity_id: UUID,
        criterion_id: UUID,
        is_met: Optional[bool],
        value: Optional[dict],
        is_override: bool,
        user_id: Optional[UUID],
        dealership_id: Optional[UUID] = None,
        *,
        mirror: bool = True,
    ) -> dict:
        """Upsert one criterion's state, then recompute the assessment."""
        _, resolved_dealership = await EligibilityService._resolve_entity_auto_values(
            db, entity_type, entity_id
        )
        assessment = await EligibilityService.get_or_create_assessment(
            db, entity_type, entity_id, dealership_id or resolved_dealership
        )

        res = await db.execute(
            select(EligibilityAssessmentItem).where(
                EligibilityAssessmentItem.assessment_id == assessment.id,
                EligibilityAssessmentItem.criterion_id == criterion_id,
            )
        )
        item = res.scalar_one_or_none()
        if item is None:
            item = EligibilityAssessmentItem(
                assessment_id=assessment.id,
                criterion_id=criterion_id,
            )
            db.add(item)

        if is_met is not None:
            item.is_met = is_met
        if value is not None:
            item.value = value
        item.is_override = is_override
        item.checked_by = user_id
        item.checked_at = utc_now()
        assessment.last_updated_by = user_id
        await db.flush()

        payload = await EligibilityService.build_assessment_payload(
            db, entity_type, entity_id, assessment.dealership_id
        )

        # Keep the linked lead/guest assessment identical
        if mirror and entity_type in (
            EligibilityEntityType.LEAD.value,
            EligibilityEntityType.GUEST.value,
        ):
            linked = await EligibilityService._get_linked_lead_guest(
                db, entity_type, entity_id
            )
            if linked:
                other_type, other_id = linked
                await EligibilityService.set_item(
                    db,
                    entity_type=other_type,
                    entity_id=other_id,
                    criterion_id=criterion_id,
                    is_met=is_met,
                    value=value,
                    is_override=is_override,
                    user_id=user_id,
                    dealership_id=dealership_id or assessment.dealership_id,
                    mirror=False,
                )

        return payload

    @staticmethod
    async def batch_guest_trust_by_lead_ids(
        db: AsyncSession,
        lead_ids: List[UUID],
        *,
        sync_empty: bool = False,
    ) -> Dict[UUID, Dict[str, Any]]:
        """Map lead_id -> guest trust info for leads that have a guest profile."""
        from app.models.guest import Guest

        if not lead_ids:
            return {}

        guest_res = await db.execute(
            select(Guest)
            .where(Guest.lead_id.in_(lead_ids))
            .order_by(Guest.created_at.asc())
        )
        guests_by_lead: Dict[UUID, Guest] = {}
        for guest in guest_res.scalars().all():
            if guest.lead_id and guest.lead_id not in guests_by_lead:
                guests_by_lead[guest.lead_id] = guest

        if sync_empty:
            for lead_id, guest in guests_by_lead.items():
                try:
                    await EligibilityService.ensure_lead_guest_assessment_sync(
                        db, EligibilityEntityType.GUEST.value, guest.id
                    )
                except Exception as e:
                    logger.warning(
                        "Failed to sync trust score for lead %s / guest %s: %s",
                        lead_id,
                        guest.id,
                        e,
                    )

        guest_ids = [g.id for g in guests_by_lead.values()]
        scores: Dict[UUID, float] = {}
        if guest_ids:
            score_res = await db.execute(
                select(EligibilityAssessment).where(
                    EligibilityAssessment.entity_type == EligibilityEntityType.GUEST.value,
                    EligibilityAssessment.entity_id.in_(guest_ids),
                )
            )
            for assessment in score_res.scalars().all():
                scores[assessment.entity_id] = float(assessment.total_score)

        lead_score_res = await db.execute(
            select(EligibilityAssessment).where(
                EligibilityAssessment.entity_type == EligibilityEntityType.LEAD.value,
                EligibilityAssessment.entity_id.in_(list(guests_by_lead.keys())),
            )
        )
        lead_scores = {
            a.entity_id: float(a.total_score) for a in lead_score_res.scalars().all()
        }

        result: Dict[UUID, Dict[str, Any]] = {}
        for lead_id, guest in guests_by_lead.items():
            guest_score = scores.get(guest.id)
            lead_score = lead_scores.get(lead_id)
            display_score = guest_score
            if (guest_score is None or float(guest_score) == 0) and lead_score and float(lead_score) > 0:
                display_score = lead_score
            result[lead_id] = {
                "guest_id": str(guest.id),
                "guest_trust_score": display_score,
            }
        return result
