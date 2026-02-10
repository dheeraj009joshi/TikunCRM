"""
LeadStage Service — CRUD, reorder, seed defaults.
"""
import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lead_stage import DEFAULT_STAGES, LeadStage

logger = logging.getLogger(__name__)


class LeadStageService:
    """Service for managing pipeline stages."""

    @staticmethod
    async def list_stages(
        db: AsyncSession,
        dealership_id: Optional[UUID] = None,
        include_inactive: bool = False,
    ) -> List[LeadStage]:
        """
        Get stages for a dealership.
        If dealership has custom stages, return those; otherwise return global defaults.
        """
        if dealership_id:
            q = select(LeadStage).where(LeadStage.dealership_id == dealership_id)
            if not include_inactive:
                q = q.where(LeadStage.is_active == True)
            q = q.order_by(LeadStage.order)
            result = await db.execute(q)
            stages = result.scalars().all()
            if stages:
                return list(stages)

        # Fallback to global stages
        q = select(LeadStage).where(LeadStage.dealership_id.is_(None))
        if not include_inactive:
            q = q.where(LeadStage.is_active == True)
        q = q.order_by(LeadStage.order)
        result = await db.execute(q)
        return list(result.scalars().all())

    @staticmethod
    async def get_stage(db: AsyncSession, stage_id: UUID) -> Optional[LeadStage]:
        result = await db.execute(select(LeadStage).where(LeadStage.id == stage_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_stage_by_name(
        db: AsyncSession, name: str, dealership_id: Optional[UUID] = None
    ) -> Optional[LeadStage]:
        """Find stage by name, preferring dealership-specific, fallback to global."""
        if dealership_id:
            q = select(LeadStage).where(
                LeadStage.name == name,
                LeadStage.dealership_id == dealership_id,
                LeadStage.is_active == True,
            )
            result = await db.execute(q)
            stage = result.scalar_one_or_none()
            if stage:
                return stage
        # Fallback global
        q = select(LeadStage).where(
            LeadStage.name == name,
            LeadStage.dealership_id.is_(None),
            LeadStage.is_active == True,
        )
        result = await db.execute(q)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_default_stage(
        db: AsyncSession, dealership_id: Optional[UUID] = None
    ) -> LeadStage:
        """Return the first non-terminal active stage (typically 'new')."""
        stages = await LeadStageService.list_stages(db, dealership_id)
        for s in stages:
            if not s.is_terminal:
                return s
        # Should never happen if seeded
        raise RuntimeError("No non-terminal lead stage found. Run seed_default_stages first.")

    @staticmethod
    async def create_stage(db: AsyncSession, **kwargs) -> LeadStage:
        stage = LeadStage(**kwargs)
        db.add(stage)
        await db.flush()
        return stage

    @staticmethod
    async def update_stage(db: AsyncSession, stage: LeadStage, data: dict) -> LeadStage:
        for field, value in data.items():
            if value is not None and hasattr(stage, field):
                setattr(stage, field, value)
        await db.flush()
        return stage

    @staticmethod
    async def reorder_stages(db: AsyncSession, ordered_ids: List[UUID]) -> None:
        """Bulk reorder stages by setting order = list index."""
        for idx, stage_id in enumerate(ordered_ids):
            await db.execute(
                update(LeadStage).where(LeadStage.id == stage_id).values(order=idx + 1)
            )
        await db.flush()

    @staticmethod
    async def seed_default_stages(db: AsyncSession) -> List[LeadStage]:
        """Create global default stages if none exist."""
        existing = await db.execute(
            select(LeadStage).where(LeadStage.dealership_id.is_(None)).limit(1)
        )
        if existing.scalar_one_or_none():
            logger.info("Global lead stages already exist, skipping seed.")
            return await LeadStageService.list_stages(db, None)

        stages = []
        for cfg in DEFAULT_STAGES:
            stage = LeadStage(
                name=cfg["name"],
                display_name=cfg["display_name"],
                order=cfg["order"],
                color=cfg["color"],
                is_terminal=cfg["is_terminal"],
                dealership_id=None,
            )
            db.add(stage)
            stages.append(stage)
        await db.flush()
        logger.info("Seeded %d global default lead stages.", len(stages))
        return stages
