"""
Pydantic Schemas for Lead
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.models.lead import LeadSource, LeadStatus
from app.schemas.user import UserBrief


class LeadBase(BaseModel):
    """Base lead schema"""
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    alternate_phone: Optional[str] = Field(None, max_length=20)


class LeadCreate(LeadBase):
    """Schema for creating a lead"""
    source: LeadSource = LeadSource.MANUAL
    notes: Optional[str] = None
    meta_data: Dict[str, Any] = Field(default_factory=dict)
    interested_in: Optional[str] = None
    budget_range: Optional[str] = None
    dealership_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None


class LeadUpdate(BaseModel):
    """Schema for updating a lead"""
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    alternate_phone: Optional[str] = Field(None, max_length=20)
    notes: Optional[str] = None
    meta_data: Optional[Dict[str, Any]] = None
    interested_in: Optional[str] = None
    budget_range: Optional[str] = None


class LeadStatusUpdate(BaseModel):
    """Schema for updating lead status"""
    status: LeadStatus
    notes: Optional[str] = None
    confirm_skate: bool = False  # If True, user confirmed they want to proceed despite SKATE warning


class LeadAssignment(BaseModel):
    """Schema for lead assignment"""
    assigned_to: UUID
    notes: Optional[str] = None


class LeadDealershipAssignment(BaseModel):
    """Schema for assigning lead to dealership"""
    dealership_id: UUID
    notes: Optional[str] = None


class BulkLeadDealershipAssignment(BaseModel):
    """Schema for bulk assigning leads to dealership"""
    lead_ids: List[UUID]
    dealership_id: UUID
    notes: Optional[str] = None


class LeadResponse(LeadBase):
    """Schema for lead response"""
    id: UUID
    full_name: Optional[str] = None  # Computed from first_name + last_name
    source: LeadSource
    status: LeadStatus
    dealership_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None
    created_by: Optional[UUID] = None
    notes: Optional[str] = None
    meta_data: Dict[str, Any]
    interested_in: Optional[str] = None
    budget_range: Optional[str] = None
    first_contacted_at: Optional[datetime] = None
    last_contacted_at: Optional[datetime] = None
    converted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class LeadBrief(BaseModel):
    """Brief lead info for lists"""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    full_name: Optional[str] = None  # Computed from first_name + last_name
    email: Optional[str] = None
    phone: Optional[str] = None
    status: LeadStatus
    source: LeadSource
    
    class Config:
        from_attributes = True


class DealershipBrief(BaseModel):
    """Brief dealership info for responses"""
    id: UUID
    name: str
    
    class Config:
        from_attributes = True


class LeadDetail(LeadResponse):
    """Detailed lead response with related user and dealership info"""
    assigned_to_user: Optional[UserBrief] = None
    created_by_user: Optional[UserBrief] = None
    dealership: Optional[DealershipBrief] = None
    access_level: Optional[str] = None  # "full" or "mention_only" (mention_only = can only read/reply to notes)


class LeadListResponse(BaseModel):
    """Paginated lead list response"""
    items: List[LeadResponse]
    total: int
    page: int
    page_size: int
    pages: int
