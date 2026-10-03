"""Snapshot campaign display names so edits apply to new leads only."""
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign_mapping import CampaignMapping
from app.models.campaign_mapping_version import CampaignMappingVersion


def _clean_message(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


async def latest_campaign_version(
    db: AsyncSession,
    mapping_id: UUID,
) -> Optional[CampaignMappingVersion]:
    result = await db.execute(
        select(CampaignMappingVersion)
        .where(CampaignMappingVersion.campaign_mapping_id == mapping_id)
        .order_by(CampaignMappingVersion.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def ensure_current_version(
    db: AsyncSession,
    mapping: CampaignMapping,
    user_id: Optional[UUID] = None,
) -> CampaignMappingVersion:
    """
    Record the mapping's current name and message when they differ from the
    latest saved version. Existing leads keep the version they already have.
    """
    display_name = (mapping.display_name or "").strip() or mapping.match_pattern
    targeting_message = _clean_message(mapping.targeting_message)
    latest = await latest_campaign_version(db, mapping.id)
    if (
        latest
        and latest.display_name == display_name
        and _clean_message(latest.targeting_message) == targeting_message
    ):
        return latest

    version = CampaignMappingVersion(
        campaign_mapping_id=mapping.id,
        display_name=display_name,
        targeting_message=targeting_message,
        created_by=user_id,
    )
    db.add(version)
    await db.flush()
    return version
