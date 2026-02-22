"""
Pydantic Schemas for Campaign Mapping
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from typing import Literal

# Use string literals to match the database enum values
MatchTypeStr = Literal["exact", "contains", "starts_with", "ends_with", "regex"]


class CampaignMappingBase(BaseModel):
    """Base campaign mapping schema"""
    match_pattern: str = Field(..., min_length=1, max_length=255, description="Pattern to match in campaign name")
    match_type: MatchTypeStr = Field(default="contains", description="How to match the pattern")
    display_name: str = Field(..., min_length=1, max_length=255, description="Display name for frontend")
    dealership_id: Optional[UUID] = Field(None, description="Dealership for leads (overrides sync source default)")
    priority: int = Field(default=100, ge=0, le=1000, description="Priority for matching (lower = higher priority)")


class CampaignMappingCreate(CampaignMappingBase):
    """Schema for creating a campaign mapping (Super Admin only)"""
    is_active: bool = Field(default=True)


class CampaignMappingUpdate(BaseModel):
    """Schema for updating a campaign mapping (Super Admin only - full update)"""
    match_pattern: Optional[str] = Field(None, min_length=1, max_length=255)
    match_type: Optional[MatchTypeStr] = None
    display_name: Optional[str] = Field(None, min_length=1, max_length=255)
    dealership_id: Optional[UUID] = None
    priority: Optional[int] = Field(None, ge=0, le=1000)
    is_active: Optional[bool] = None


class CampaignMappingDisplayNameUpdate(BaseModel):
    """Schema for updating only display name (Dealership Admin/Owner)"""
    display_name: str = Field(..., min_length=1, max_length=255, description="New display name")


class DealershipBrief(BaseModel):
    """Brief dealership info"""
    id: UUID
    name: str

    class Config:
        from_attributes = True


class UserBrief(BaseModel):
    """Brief user info"""
    id: UUID
    email: str
    first_name: str
    last_name: Optional[str] = None

    class Config:
        from_attributes = True


class SyncSourceBrief(BaseModel):
    """Brief sync source info"""
    id: UUID
    name: str
    display_name: str

    class Config:
        from_attributes = True


class CampaignMappingResponse(CampaignMappingBase):
    """Schema for campaign mapping response"""
    id: UUID
    sync_source_id: UUID
    is_active: bool
    leads_matched: int
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # Nested objects
    dealership: Optional[DealershipBrief] = None
    creator: Optional[UserBrief] = None
    updater: Optional[UserBrief] = None
    sync_source: Optional[SyncSourceBrief] = None

    class Config:
        from_attributes = True


class CampaignMappingList(BaseModel):
    """List of campaign mappings"""
    items: List[CampaignMappingResponse]
    total: int


class CampaignMappingForDealership(BaseModel):
    """Campaign mapping view for Dealership Admin/Owner"""
    id: UUID
    sync_source_id: UUID
    sync_source_name: str
    match_pattern: str
    match_type: MatchTypeStr
    display_name: str
    is_active: bool
    leads_matched: int
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class DealershipCampaignMappingList(BaseModel):
    """List of campaign mappings for a dealership"""
    dealership_id: UUID
    dealership_name: str
    items: List[CampaignMappingForDealership]
    total: int
