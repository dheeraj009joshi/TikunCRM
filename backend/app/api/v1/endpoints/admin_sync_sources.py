"""
Admin Lead Sync Sources Endpoints (Super Admin only)

Manages lead sync sources (Google Sheets) and campaign mappings.
"""
import logging
from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.lead_sync_source import LeadSyncSource
from app.models.campaign_mapping import CampaignMapping
from app.models.dealership import Dealership
from app.models.user import User
from app.models.lead import Lead
from app.schemas.lead_sync_source import (
    LeadSyncSourceCreate,
    LeadSyncSourceUpdate,
    LeadSyncSourceResponse,
    LeadSyncSourceWithMappings,
    LeadSyncSourceList,
    SheetPreviewResponse,
    SheetPreviewRow,
    ManualSyncResponse,
    SheetPreviewByUrlRequest,
    SheetPreviewByUrlResponse,
    SyncSourceWithMappingsCreate,
)
from app.schemas.campaign_mapping import (
    CampaignMappingCreate,
    CampaignMappingUpdate,
    CampaignMappingResponse,
    CampaignMappingList,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def require_super_admin():
    """Dependency to require super admin role"""
    return deps.require_permission(Permission.CREATE_DEALERSHIP)


# ============================================================================
# LEAD SYNC SOURCE ENDPOINTS
# ============================================================================

@router.get("/", response_model=LeadSyncSourceList)
async def list_sync_sources(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
    skip: int = 0,
    limit: int = 100,
    include_inactive: bool = False,
) -> Any:
    """
    List all lead sync sources (Super Admin only).
    """
    query = select(LeadSyncSource).options(
        selectinload(LeadSyncSource.default_dealership),
        selectinload(LeadSyncSource.creator),
        selectinload(LeadSyncSource.campaign_mappings).selectinload(CampaignMapping.dealership),
    )
    
    if not include_inactive:
        query = query.where(LeadSyncSource.is_active == True)
    
    query = query.order_by(LeadSyncSource.created_at.desc())
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    sources = result.scalars().all()
    
    # Get total count
    count_query = select(func.count(LeadSyncSource.id))
    if not include_inactive:
        count_query = count_query.where(LeadSyncSource.is_active == True)
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0
    
    return LeadSyncSourceList(items=sources, total=total)


# ============================================================================
# WIZARD ENDPOINTS: Preview Sheet by URL & Batch Create
# ============================================================================

@router.post("/preview-sheet", response_model=SheetPreviewByUrlResponse)
async def preview_sheet_by_url(
    request: SheetPreviewByUrlRequest,
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Preview a Google Sheet by URL BEFORE creating a sync source (Super Admin only).
    Returns total rows, unique campaigns, and sample data.
    """
    try:
        from app.services.google_sheets_sync import fetch_sheet_data_raw
        
        sheet_id = request.sheet_url  # Already extracted by validator
        sheet_gid = request.sheet_gid
        
        # Fetch raw sheet data
        rows = await fetch_sheet_data_raw(sheet_id, sheet_gid)
        
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No data found in sheet. Make sure the sheet is publicly accessible."
            )
        
        # Extract unique campaigns
        unique_campaigns = set()
        sample_rows = []
        
        for idx, row in enumerate(rows[:100]):  # Check first 100 rows for campaigns
            campaign = row.get("campaign_name") or row.get("campaign") or row.get("ad_name") or ""
            if campaign and campaign.strip():
                unique_campaigns.add(campaign.strip())
            
            # Collect sample rows (first 10)
            if idx < 10:
                from app.schemas.lead_sync_source import SheetPreviewRow
                sample_rows.append(SheetPreviewRow(
                    row_number=idx + 2,  # +2 for header row and 0-index
                    full_name=row.get("full_name") or row.get("name") or "",
                    phone=row.get("phone") or row.get("phone_number") or "",
                    email=row.get("email") or "",
                    campaign_name=campaign,
                ))
        
        return SheetPreviewByUrlResponse(
            sheet_id=sheet_id,
            sheet_gid=sheet_gid,
            total_rows=len(rows),
            unique_campaigns=sorted(list(unique_campaigns)),
            sample_rows=sample_rows,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to preview sheet: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch sheet: {str(e)}. Make sure the sheet is publicly accessible."
        )


@router.post("/with-mappings", response_model=LeadSyncSourceWithMappings, status_code=status.HTTP_201_CREATED)
async def create_sync_source_with_mappings(
    request: SyncSourceWithMappingsCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Create a sync source AND all campaign mappings in one atomic transaction (Super Admin only).
    This is the wizard endpoint that creates everything at once.
    """
    source_data = request.source
    mappings_data = request.campaign_mappings
    
    # Validate dealership if provided
    if source_data.default_dealership_id:
        dealership_result = await db.execute(
            select(Dealership).where(Dealership.id == source_data.default_dealership_id)
        )
        if not dealership_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Default dealership not found"
            )
    
    # Validate all mapping dealerships
    for mapping in mappings_data:
        if mapping.dealership_id:
            dealership_result = await db.execute(
                select(Dealership).where(Dealership.id == mapping.dealership_id)
            )
            if not dealership_result.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Dealership not found for mapping '{mapping.match_pattern}'"
                )
    
    try:
        # Create sync source
        source = LeadSyncSource(
            **source_data.model_dump(),
            created_by=current_user.id,
        )
        db.add(source)
        await db.flush()  # Get source ID before creating mappings
        
        # Create all campaign mappings
        for mapping_data in mappings_data:
            mapping = CampaignMapping(
                sync_source_id=source.id,
                match_pattern=mapping_data.match_pattern,
                match_type=mapping_data.match_type,
                display_name=mapping_data.display_name,
                dealership_id=mapping_data.dealership_id,
                priority=mapping_data.priority,
                is_active=mapping_data.is_active,
                created_by=current_user.id,
            )
            db.add(mapping)
        
        await db.commit()
        
        # Reload with relationships
        query = select(LeadSyncSource).where(LeadSyncSource.id == source.id).options(
            selectinload(LeadSyncSource.default_dealership),
            selectinload(LeadSyncSource.creator),
            selectinload(LeadSyncSource.campaign_mappings).selectinload(CampaignMapping.dealership),
        )
        result = await db.execute(query)
        source = result.scalar_one()
        
        logger.info(f"Sync source created with {len(mappings_data)} mappings: {source.name} by {current_user.email}")
        
        return source
        
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to create sync source with mappings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create sync source: {str(e)}"
        )


@router.get("/{source_id}", response_model=LeadSyncSourceWithMappings)
async def get_sync_source(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Get a specific sync source with its campaign mappings (Super Admin only).
    """
    query = select(LeadSyncSource).where(LeadSyncSource.id == source_id).options(
        selectinload(LeadSyncSource.default_dealership),
        selectinload(LeadSyncSource.creator),
        selectinload(LeadSyncSource.campaign_mappings).selectinload(CampaignMapping.dealership),
    )
    
    result = await db.execute(query)
    source = result.scalar_one_or_none()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    return source


@router.post("/", response_model=LeadSyncSourceResponse, status_code=status.HTTP_201_CREATED)
async def create_sync_source(
    *,
    db: AsyncSession = Depends(get_db),
    source_in: LeadSyncSourceCreate,
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Create a new lead sync source (Super Admin only).
    """
    # Validate dealership if provided
    if source_in.default_dealership_id:
        dealership_result = await db.execute(
            select(Dealership).where(Dealership.id == source_in.default_dealership_id)
        )
        if not dealership_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dealership not found"
            )
    
    # Create sync source
    source = LeadSyncSource(
        **source_in.model_dump(),
        created_by=current_user.id,
    )
    
    db.add(source)
    await db.commit()
    await db.refresh(source)
    
    logger.info(f"Sync source created: {source.name} by {current_user.email}")
    
    return source


@router.put("/{source_id}", response_model=LeadSyncSourceResponse)
async def update_sync_source(
    source_id: UUID,
    *,
    db: AsyncSession = Depends(get_db),
    source_in: LeadSyncSourceUpdate,
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Update a sync source (Super Admin only).
    """
    query = select(LeadSyncSource).where(LeadSyncSource.id == source_id)
    result = await db.execute(query)
    source = result.scalar_one_or_none()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    # Validate dealership if provided
    if source_in.default_dealership_id:
        dealership_result = await db.execute(
            select(Dealership).where(Dealership.id == source_in.default_dealership_id)
        )
        if not dealership_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dealership not found"
            )
    
    # Update fields
    update_data = source_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(source, field, value)
    
    await db.commit()
    await db.refresh(source)
    
    logger.info(f"Sync source updated: {source.name} by {current_user.email}")
    
    return source


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sync_source(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
) -> None:
    """
    Delete a sync source (Super Admin only).
    This will also delete all campaign mappings for this source.
    Leads synced from this source will retain their data but lose the reference.
    """
    query = select(LeadSyncSource).where(LeadSyncSource.id == source_id)
    result = await db.execute(query)
    source = result.scalar_one_or_none()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    logger.info(f"Deleting sync source: {source.name} by {current_user.email}")
    
    await db.delete(source)
    await db.commit()


@router.post("/{source_id}/sync", response_model=ManualSyncResponse)
async def trigger_manual_sync(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Trigger a manual sync for a specific source (Super Admin only).
    """
    import time
    
    query = select(LeadSyncSource).where(LeadSyncSource.id == source_id)
    result = await db.execute(query)
    source = result.scalar_one_or_none()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    if not source.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot sync inactive source"
        )
    
    start_time = time.time()
    
    try:
        from app.services.google_sheets_sync import sync_leads_from_source
        sync_result = await sync_leads_from_source(source)
        
        duration = time.time() - start_time
        
        logger.info(f"Manual sync completed for {source.name}: {sync_result}")
        
        return ManualSyncResponse(
            source_id=source.id,
            source_name=source.name,
            leads_synced=sync_result.get("new_leads", 0),
            leads_updated=sync_result.get("updated_leads", 0),
            leads_skipped=sync_result.get("skipped_leads", 0),
            errors=sync_result.get("errors", []),
            sync_duration_seconds=round(duration, 2),
        )
    except Exception as e:
        logger.error(f"Manual sync failed for {source.name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Sync failed: {str(e)}"
        )


@router.get("/{source_id}/preview", response_model=SheetPreviewResponse)
async def preview_sheet_data(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
    limit: int = 10,
) -> Any:
    """
    Preview data from a sync source sheet (Super Admin only).
    Shows sample rows and lists unique/unmapped campaigns.
    """
    query = select(LeadSyncSource).where(LeadSyncSource.id == source_id).options(
        selectinload(LeadSyncSource.campaign_mappings)
    )
    result = await db.execute(query)
    source = result.scalar_one_or_none()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    try:
        from app.services.google_sheets_sync import fetch_sheet_preview
        preview_data = await fetch_sheet_preview(source, limit=limit)
        
        return SheetPreviewResponse(
            source_id=source.id,
            source_name=source.name,
            total_rows=preview_data.get("total_rows", 0),
            sample_rows=preview_data.get("sample_rows", []),
            unique_campaigns=preview_data.get("unique_campaigns", []),
            unmapped_campaigns=preview_data.get("unmapped_campaigns", []),
        )
    except Exception as e:
        logger.error(f"Preview failed for {source.name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Preview failed: {str(e)}"
        )


# ============================================================================
# CAMPAIGN MAPPING ENDPOINTS (nested under sync source)
# ============================================================================

@router.get("/{source_id}/campaigns", response_model=CampaignMappingList)
async def list_campaign_mappings(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
    include_inactive: bool = False,
) -> Any:
    """
    List all campaign mappings for a sync source (Super Admin only).
    """
    # Verify source exists
    source_result = await db.execute(
        select(LeadSyncSource).where(LeadSyncSource.id == source_id)
    )
    if not source_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    query = select(CampaignMapping).where(
        CampaignMapping.sync_source_id == source_id
    ).options(
        selectinload(CampaignMapping.dealership),
        selectinload(CampaignMapping.creator),
        selectinload(CampaignMapping.updater),
    )
    
    if not include_inactive:
        query = query.where(CampaignMapping.is_active == True)
    
    query = query.order_by(CampaignMapping.priority.asc())
    
    result = await db.execute(query)
    mappings = result.scalars().all()
    
    return CampaignMappingList(items=mappings, total=len(mappings))


@router.post("/{source_id}/campaigns", response_model=CampaignMappingResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign_mapping(
    source_id: UUID,
    *,
    db: AsyncSession = Depends(get_db),
    mapping_in: CampaignMappingCreate,
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Create a new campaign mapping for a sync source (Super Admin only).
    """
    # Verify source exists
    source_result = await db.execute(
        select(LeadSyncSource).where(LeadSyncSource.id == source_id)
    )
    source = source_result.scalar_one_or_none()
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync source not found"
        )
    
    # Check for duplicate pattern
    existing_result = await db.execute(
        select(CampaignMapping).where(
            CampaignMapping.sync_source_id == source_id,
            CampaignMapping.match_pattern == mapping_in.match_pattern,
        )
    )
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A mapping with this pattern already exists for this source"
        )
    
    # Validate dealership if provided
    if mapping_in.dealership_id:
        dealership_result = await db.execute(
            select(Dealership).where(Dealership.id == mapping_in.dealership_id)
        )
        if not dealership_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dealership not found"
            )
    
    # Create mapping
    mapping = CampaignMapping(
        **mapping_in.model_dump(),
        sync_source_id=source_id,
        created_by=current_user.id,
    )
    
    db.add(mapping)
    await db.commit()
    await db.refresh(mapping)
    
    logger.info(f"Campaign mapping created: '{mapping.match_pattern}' -> '{mapping.display_name}' by {current_user.email}")
    
    return mapping


@router.put("/{source_id}/campaigns/{mapping_id}", response_model=CampaignMappingResponse)
async def update_campaign_mapping(
    source_id: UUID,
    mapping_id: UUID,
    *,
    db: AsyncSession = Depends(get_db),
    mapping_in: CampaignMappingUpdate,
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Update a campaign mapping (Super Admin only - full update).
    """
    query = select(CampaignMapping).where(
        CampaignMapping.id == mapping_id,
        CampaignMapping.sync_source_id == source_id,
    ).options(
        selectinload(CampaignMapping.dealership),
    )
    
    result = await db.execute(query)
    mapping = result.scalar_one_or_none()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign mapping not found"
        )
    
    # Check for duplicate pattern if pattern is being changed
    if mapping_in.match_pattern and mapping_in.match_pattern != mapping.match_pattern:
        existing_result = await db.execute(
            select(CampaignMapping).where(
                CampaignMapping.sync_source_id == source_id,
                CampaignMapping.match_pattern == mapping_in.match_pattern,
                CampaignMapping.id != mapping_id,
            )
        )
        if existing_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A mapping with this pattern already exists for this source"
            )
    
    # Validate dealership if provided
    if mapping_in.dealership_id:
        dealership_result = await db.execute(
            select(Dealership).where(Dealership.id == mapping_in.dealership_id)
        )
        if not dealership_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Dealership not found"
            )
    
    # Update fields
    update_data = mapping_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(mapping, field, value)
    
    mapping.updated_by = current_user.id
    
    await db.commit()
    await db.refresh(mapping)
    
    logger.info(f"Campaign mapping updated: '{mapping.match_pattern}' by {current_user.email}")
    
    return mapping


@router.delete("/{source_id}/campaigns/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign_mapping(
    source_id: UUID,
    mapping_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
) -> None:
    """
    Delete a campaign mapping (Super Admin only).
    """
    query = select(CampaignMapping).where(
        CampaignMapping.id == mapping_id,
        CampaignMapping.sync_source_id == source_id,
    )
    
    result = await db.execute(query)
    mapping = result.scalar_one_or_none()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign mapping not found"
        )
    
    logger.info(f"Deleting campaign mapping: '{mapping.match_pattern}' by {current_user.email}")
    
    await db.delete(mapping)
    await db.commit()


# ============================================================================
# DEALERSHIPS HELPER ENDPOINT
# ============================================================================

@router.get("/dealerships/list", response_model=List[dict])
async def list_dealerships_for_dropdown(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin()),
) -> Any:
    """
    Get list of active dealerships for dropdown selection (Super Admin only).
    """
    result = await db.execute(
        select(Dealership).where(Dealership.is_active == True).order_by(Dealership.name)
    )
    dealerships = result.scalars().all()
    
    return [{"id": str(d.id), "name": d.name} for d in dealerships]
