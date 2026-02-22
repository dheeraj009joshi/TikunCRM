"""
Pydantic Schemas for Lead Sync Source
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
import re

from typing import Literal

# Use string literals instead of enum for API compatibility
SourceTypeStr = Literal["google_sheets", "csv_upload", "api"]


class LeadSyncSourceBase(BaseModel):
    """Base sync source schema"""
    name: str = Field(..., min_length=1, max_length=100, description="Internal name")
    display_name: str = Field(..., min_length=1, max_length=150, description="Display name in UI")
    description: Optional[str] = Field(None, description="Optional description")
    source_type: SourceTypeStr = Field(default="google_sheets")
    sheet_id: str = Field(..., min_length=1, max_length=100, description="Google Sheet ID")
    sheet_gid: str = Field(default="0", max_length=20, description="Sheet tab GID")
    default_dealership_id: Optional[UUID] = Field(None, description="Default dealership for leads")
    default_campaign_display: Optional[str] = Field(None, max_length=150, description="Default display when no campaign matches")
    sync_interval_minutes: int = Field(default=5, ge=1, le=1440, description="Sync interval in minutes")


class LeadSyncSourceCreate(LeadSyncSourceBase):
    """Schema for creating a sync source (Super Admin only)"""
    is_active: bool = Field(default=True)

    @field_validator('sheet_id', mode='before')
    @classmethod
    def extract_sheet_id_from_url(cls, v):
        """Extract sheet ID from full Google Sheets URL if provided"""
        if not v:
            return v
        # Check if it's a full URL
        if 'docs.google.com/spreadsheets' in v:
            # Extract the ID from URL like:
            # https://docs.google.com/spreadsheets/d/1_7Qdzgjj9Ye5V7ZW0_gYblqU8V9pkbjDjkahTl8O4kI/edit#gid=0
            match = re.search(r'/d/([a-zA-Z0-9_-]+)', v)
            if match:
                return match.group(1)
        return v

    @field_validator('sheet_gid', mode='before')
    @classmethod
    def extract_gid_from_url(cls, v, info):
        """Extract GID from URL if sheet_id contains full URL"""
        # This is handled separately if needed
        return v or "0"


class LeadSyncSourceUpdate(BaseModel):
    """Schema for updating a sync source (Super Admin only)"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, min_length=1, max_length=150)
    description: Optional[str] = None
    sheet_id: Optional[str] = Field(None, min_length=1, max_length=100)
    sheet_gid: Optional[str] = Field(None, max_length=20)
    default_dealership_id: Optional[UUID] = None
    default_campaign_display: Optional[str] = Field(None, max_length=150)
    sync_interval_minutes: Optional[int] = Field(None, ge=1, le=1440)
    is_active: Optional[bool] = None


class DealershipBrief(BaseModel):
    """Brief dealership info for nested responses"""
    id: UUID
    name: str

    class Config:
        from_attributes = True


class UserBrief(BaseModel):
    """Brief user info for nested responses"""
    id: UUID
    email: str
    first_name: str
    last_name: Optional[str] = None

    class Config:
        from_attributes = True


class CampaignMappingBrief(BaseModel):
    """Brief campaign mapping for sync source response"""
    id: UUID
    match_pattern: str
    match_type: str
    display_name: str
    dealership_id: Optional[UUID] = None
    dealership: Optional[DealershipBrief] = None
    priority: int
    is_active: bool
    leads_matched: int

    class Config:
        from_attributes = True


class LeadSyncSourceResponse(LeadSyncSourceBase):
    """Schema for sync source response"""
    id: UUID
    is_active: bool
    last_synced_at: Optional[datetime] = None
    last_sync_lead_count: int = 0
    total_leads_synced: int = 0
    last_sync_error: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # Computed properties
    sheet_url: str
    export_url: str
    
    # Nested objects
    default_dealership: Optional[DealershipBrief] = None
    creator: Optional[UserBrief] = None

    class Config:
        from_attributes = True


class LeadSyncSourceWithMappings(LeadSyncSourceResponse):
    """Sync source with campaign mappings"""
    campaign_mappings: List[CampaignMappingBrief] = []


class LeadSyncSourceList(BaseModel):
    """List of sync sources with campaign mappings"""
    items: List[LeadSyncSourceWithMappings]
    total: int


class SheetPreviewRow(BaseModel):
    """Preview of a row from the sheet"""
    row_number: int
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    campaign_name: Optional[str] = None
    matched_mapping: Optional[str] = None
    target_dealership: Optional[str] = None


class SheetPreviewResponse(BaseModel):
    """Preview response for a sync source"""
    source_id: UUID
    source_name: str
    total_rows: int
    sample_rows: List[SheetPreviewRow]
    unique_campaigns: List[str]
    unmapped_campaigns: List[str]


class ManualSyncResponse(BaseModel):
    """Response from manual sync trigger"""
    source_id: UUID
    source_name: str
    leads_synced: int
    leads_updated: int
    leads_skipped: int
    errors: List[str] = []
    sync_duration_seconds: float


# ============== WIZARD: Preview by URL & Batch Create ==============

class SheetPreviewByUrlRequest(BaseModel):
    """Request to preview a sheet by URL (before creating source)"""
    sheet_url: str = Field(..., description="Full Google Sheet URL or just the sheet ID")
    sheet_gid: str = Field(default="0", description="Sheet tab GID")

    @field_validator('sheet_url', mode='before')
    @classmethod
    def extract_sheet_id(cls, v):
        """Extract sheet ID from full URL if provided"""
        if not v:
            return v
        if 'docs.google.com/spreadsheets' in v:
            match = re.search(r'/d/([a-zA-Z0-9_-]+)', v)
            if match:
                return match.group(1)
        return v


class SheetPreviewByUrlResponse(BaseModel):
    """Response for preview by URL (before source exists)"""
    sheet_id: str
    sheet_gid: str
    total_rows: int
    unique_campaigns: List[str]
    sample_rows: List[SheetPreviewRow]


class CampaignMappingInput(BaseModel):
    """Campaign mapping input for batch create"""
    match_pattern: str = Field(..., min_length=1)
    match_type: str = Field(default="contains")
    display_name: str = Field(..., min_length=1)
    dealership_id: Optional[UUID] = None
    priority: int = Field(default=100)
    is_active: bool = Field(default=True)


class SyncSourceWithMappingsCreate(BaseModel):
    """Create sync source with all campaign mappings in one request"""
    source: LeadSyncSourceCreate
    campaign_mappings: List[CampaignMappingInput] = []
