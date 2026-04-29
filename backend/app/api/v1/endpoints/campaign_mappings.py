"""
Campaign Mappings Endpoints (Dealership Admin/Owner)

Allows Dealership Admin/Owner to view and edit display names for
campaign mappings assigned to their dealership.
"""
import logging
from typing import Any, Dict, List, Set
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.campaign_mapping import CampaignMapping
from app.models.lead import Lead
from app.models.lead_sync_source import LeadSyncSource
from app.models.dealership import Dealership
from app.models.user import User
from app.schemas.campaign_mapping import (
    CampaignMappingDisplayNameUpdate,
    CampaignMappingForDealership,
    CampaignWhatsAppTemplateUpdate,
    DealershipCampaignMappingList,
    WhatsAppTemplateBrief,
)
from app.models.whatsapp_template import WhatsAppTemplate

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_lead_counts_by_mapping(
    db: AsyncSession, mapping_ids: Set[UUID]
) -> Dict[UUID, int]:
    """
    Get actual lead counts for campaign mappings by counting leads in the database.
    This replaces the stored counter which can drift from reality.
    """
    if not mapping_ids:
        return {}
    
    count_query = (
        select(Lead.campaign_mapping_id, func.count(Lead.id).label("lead_count"))
        .where(Lead.campaign_mapping_id.in_(mapping_ids))
        .group_by(Lead.campaign_mapping_id)
    )
    
    result = await db.execute(count_query)
    rows = result.fetchall()
    
    return {row[0]: row[1] for row in rows}


def get_dealership_admin_or_higher():
    """
    Dependency to require dealership admin, owner, or super admin.
    """
    async def _check_role(
        current_user: User = Depends(deps.get_current_active_user),
    ) -> User:
        allowed_roles = {
            UserRole.SUPER_ADMIN,
            UserRole.DEALERSHIP_OWNER,
            UserRole.DEALERSHIP_ADMIN,
        }
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only dealership admins, owners, or super admins can access this resource"
            )
        return current_user
    
    return _check_role


def _build_mapping_response(
    m: CampaignMapping,
    lead_count: int,
) -> CampaignMappingForDealership:
    """Build a CampaignMappingForDealership response with WhatsApp template info."""
    wa_template_brief = None
    if m.whatsapp_template:
        wa_template_brief = WhatsAppTemplateBrief(
            id=m.whatsapp_template.id,
            content_sid=m.whatsapp_template.content_sid,
            name=m.whatsapp_template.name,
            variable_names=m.whatsapp_template.variable_names or [],
        )
    
    return CampaignMappingForDealership(
        id=m.id,
        sync_source_id=m.sync_source_id,
        sync_source_name=m.sync_source.name if m.sync_source else "Unknown",
        match_pattern=m.match_pattern,
        match_type=m.match_type,
        display_name=m.display_name,
        is_active=m.is_active,
        leads_matched=lead_count,
        updated_at=m.updated_at,
        whatsapp_template_id=m.whatsapp_template_id,
        whatsapp_template=wa_template_brief,
        whatsapp_auto_send=m.whatsapp_auto_send,
    )


@router.get("/", response_model=DealershipCampaignMappingList)
async def list_my_campaign_mappings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_dealership_admin_or_higher()),
) -> Any:
    """
    List campaign mappings for the current user's dealership.
    
    - Super Admin: sees all mappings across all dealerships
    - Dealership Owner/Admin: sees mappings assigned to their dealership
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        # Super admin sees all mappings
        query = select(CampaignMapping).where(
            CampaignMapping.is_active == True
        ).options(
            selectinload(CampaignMapping.sync_source),
            selectinload(CampaignMapping.dealership),
            selectinload(CampaignMapping.whatsapp_template),
        ).order_by(CampaignMapping.sync_source_id, CampaignMapping.priority)
        
        result = await db.execute(query)
        mappings = result.scalars().all()
        
        # Get actual lead counts dynamically
        mapping_ids = {m.id for m in mappings}
        lead_counts = await get_lead_counts_by_mapping(db, mapping_ids)
        
        items = [_build_mapping_response(m, lead_counts.get(m.id, 0)) for m in mappings]
        
        return DealershipCampaignMappingList(
            dealership_id=UUID("00000000-0000-0000-0000-000000000000"),
            dealership_name="All Dealerships",
            items=items,
            total=len(items),
        )
    
    # Dealership admin/owner - get their dealership
    if not current_user.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to a dealership"
        )
    
    # Get dealership info
    dealership_result = await db.execute(
        select(Dealership).where(Dealership.id == current_user.dealership_id)
    )
    dealership = dealership_result.scalar_one_or_none()
    if not dealership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dealership not found"
        )
    
    # Get mappings where:
    # 1. campaign_mapping.dealership_id matches user's dealership, OR
    # 2. sync_source.default_dealership_id matches and mapping has no dealership override
    query = select(CampaignMapping).join(
        LeadSyncSource, CampaignMapping.sync_source_id == LeadSyncSource.id
    ).where(
        CampaignMapping.is_active == True,
        or_(
            CampaignMapping.dealership_id == current_user.dealership_id,
            # Mapping inherits from sync source
            (CampaignMapping.dealership_id.is_(None)) & 
            (LeadSyncSource.default_dealership_id == current_user.dealership_id)
        )
    ).options(
        selectinload(CampaignMapping.sync_source),
        selectinload(CampaignMapping.whatsapp_template),
    ).order_by(CampaignMapping.sync_source_id, CampaignMapping.priority)
    
    result = await db.execute(query)
    mappings = result.scalars().all()
    
    # Get actual lead counts dynamically
    mapping_ids = {m.id for m in mappings}
    lead_counts = await get_lead_counts_by_mapping(db, mapping_ids)
    
    items = [_build_mapping_response(m, lead_counts.get(m.id, 0)) for m in mappings]
    
    return DealershipCampaignMappingList(
        dealership_id=dealership.id,
        dealership_name=dealership.name,
        items=items,
        total=len(items),
    )


@router.put("/{mapping_id}/display-name", response_model=CampaignMappingForDealership)
async def update_campaign_display_name(
    mapping_id: UUID,
    *,
    db: AsyncSession = Depends(get_db),
    update_in: CampaignMappingDisplayNameUpdate,
    current_user: User = Depends(get_dealership_admin_or_higher()),
) -> Any:
    """
    Update only the display name for a campaign mapping.
    
    - Super Admin: can update any mapping
    - Dealership Owner/Admin: can only update mappings assigned to their dealership
    """
    # Get the mapping with its sync source and whatsapp template
    query = select(CampaignMapping).where(
        CampaignMapping.id == mapping_id
    ).options(
        selectinload(CampaignMapping.sync_source),
        selectinload(CampaignMapping.whatsapp_template),
    )
    
    result = await db.execute(query)
    mapping = result.scalar_one_or_none()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign mapping not found"
        )
    
    # Check permission
    if current_user.role != UserRole.SUPER_ADMIN:
        if not current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is not assigned to a dealership"
            )
        
        # Check if mapping belongs to user's dealership
        mapping_dealership_id = mapping.dealership_id
        if mapping_dealership_id is None and mapping.sync_source:
            mapping_dealership_id = mapping.sync_source.default_dealership_id
        
        if mapping_dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only edit mappings assigned to your dealership"
            )
    
    # Update only the display name
    old_display_name = mapping.display_name
    mapping.display_name = update_in.display_name
    mapping.updated_by = current_user.id
    
    await db.commit()
    await db.refresh(mapping)
    
    logger.info(
        f"Campaign mapping display name updated: '{old_display_name}' -> '{mapping.display_name}' "
        f"by {current_user.email} (role: {current_user.role})"
    )
    
    # Get actual lead count dynamically
    lead_counts = await get_lead_counts_by_mapping(db, {mapping.id})
    
    return _build_mapping_response(mapping, lead_counts.get(mapping.id, 0))


@router.get("/{mapping_id}", response_model=CampaignMappingForDealership)
async def get_campaign_mapping(
    mapping_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_dealership_admin_or_higher()),
) -> Any:
    """
    Get a specific campaign mapping.
    
    - Super Admin: can view any mapping
    - Dealership Owner/Admin: can only view mappings assigned to their dealership
    """
    query = select(CampaignMapping).where(
        CampaignMapping.id == mapping_id
    ).options(
        selectinload(CampaignMapping.sync_source),
        selectinload(CampaignMapping.whatsapp_template),
    )
    
    result = await db.execute(query)
    mapping = result.scalar_one_or_none()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign mapping not found"
        )
    
    # Check permission
    if current_user.role != UserRole.SUPER_ADMIN:
        if not current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is not assigned to a dealership"
            )
        
        # Check if mapping belongs to user's dealership
        mapping_dealership_id = mapping.dealership_id
        if mapping_dealership_id is None and mapping.sync_source:
            mapping_dealership_id = mapping.sync_source.default_dealership_id
        
        if mapping_dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view mappings assigned to your dealership"
            )
    
    # Get actual lead count dynamically
    lead_counts = await get_lead_counts_by_mapping(db, {mapping.id})
    
    return _build_mapping_response(mapping, lead_counts.get(mapping.id, 0))


@router.patch("/{mapping_id}/whatsapp-template", response_model=CampaignMappingForDealership)
async def update_campaign_whatsapp_template(
    mapping_id: UUID,
    *,
    db: AsyncSession = Depends(get_db),
    update_in: CampaignWhatsAppTemplateUpdate,
    current_user: User = Depends(get_dealership_admin_or_higher()),
) -> Any:
    """
    Update WhatsApp template assignment for a campaign mapping.
    
    - Super Admin: can update any mapping
    - Dealership Owner/Admin: can only update mappings assigned to their dealership
    
    Set whatsapp_template_id to null to remove template assignment.
    Set whatsapp_auto_send to true to auto-send template when new leads match this campaign.
    """
    # Get the mapping with its sync source
    query = select(CampaignMapping).where(
        CampaignMapping.id == mapping_id
    ).options(
        selectinload(CampaignMapping.sync_source),
        selectinload(CampaignMapping.whatsapp_template),
    )
    
    result = await db.execute(query)
    mapping = result.scalar_one_or_none()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign mapping not found"
        )
    
    # Check permission
    if current_user.role != UserRole.SUPER_ADMIN:
        if not current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User is not assigned to a dealership"
            )
        
        # Check if mapping belongs to user's dealership
        mapping_dealership_id = mapping.dealership_id
        if mapping_dealership_id is None and mapping.sync_source:
            mapping_dealership_id = mapping.sync_source.default_dealership_id
        
        if mapping_dealership_id != current_user.dealership_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only update mappings assigned to your dealership"
            )
    
    # Validate template exists and is accessible if provided
    if update_in.whatsapp_template_id is not None:
        template_result = await db.execute(
            select(WhatsAppTemplate).where(WhatsAppTemplate.id == update_in.whatsapp_template_id)
        )
        template = template_result.scalar_one_or_none()
        
        if not template:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="WhatsApp template not found"
            )
        
        # Check template is accessible (global or same dealership)
        if template.dealership_id is not None:
            effective_dealership = mapping.dealership_id
            if effective_dealership is None and mapping.sync_source:
                effective_dealership = mapping.sync_source.default_dealership_id
            
            if template.dealership_id != effective_dealership:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot use a template from another dealership"
                )
    
    # Update fields
    old_template_id = mapping.whatsapp_template_id
    old_auto_send = mapping.whatsapp_auto_send
    
    mapping.whatsapp_template_id = update_in.whatsapp_template_id
    mapping.whatsapp_auto_send = update_in.whatsapp_auto_send
    mapping.updated_by = current_user.id
    
    await db.commit()
    
    # Reload with template relationship
    await db.refresh(mapping)
    query = select(CampaignMapping).where(
        CampaignMapping.id == mapping_id
    ).options(
        selectinload(CampaignMapping.sync_source),
        selectinload(CampaignMapping.whatsapp_template),
    )
    result = await db.execute(query)
    mapping = result.scalar_one()
    
    logger.info(
        f"Campaign WhatsApp template updated: mapping={mapping_id} "
        f"template={old_template_id}->{mapping.whatsapp_template_id} "
        f"auto_send={old_auto_send}->{mapping.whatsapp_auto_send} "
        f"by {current_user.email}"
    )
    
    # Get actual lead count dynamically
    lead_counts = await get_lead_counts_by_mapping(db, {mapping.id})
    
    return _build_mapping_response(mapping, lead_counts.get(mapping.id, 0))
