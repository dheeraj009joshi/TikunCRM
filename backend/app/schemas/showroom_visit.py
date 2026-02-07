"""
Pydantic Schemas for Showroom Visit
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.showroom_visit import ShowroomOutcome


class ShowroomCheckIn(BaseModel):
    """Schema for checking in a customer"""
    lead_id: UUID
    appointment_id: Optional[UUID] = None
    notes: Optional[str] = None


class ShowroomCheckOut(BaseModel):
    """Schema for checking out a customer"""
    outcome: ShowroomOutcome
    notes: Optional[str] = None


class LeadBrief(BaseModel):
    """Brief lead info for showroom response"""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: str
    
    class Config:
        from_attributes = True


class UserBrief(BaseModel):
    """Brief user info"""
    id: UUID
    first_name: str
    last_name: str
    email: str
    
    class Config:
        from_attributes = True


class ShowroomVisitResponse(BaseModel):
    """Schema for showroom visit response"""
    id: UUID
    lead_id: UUID
    appointment_id: Optional[UUID] = None
    dealership_id: UUID
    checked_in_at: datetime
    checked_in_by: Optional[UUID] = None
    checked_out_at: Optional[datetime] = None
    checked_out_by: Optional[UUID] = None
    outcome: Optional[ShowroomOutcome] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    # Related data
    lead: Optional[LeadBrief] = None
    checked_in_by_user: Optional[UserBrief] = None
    checked_out_by_user: Optional[UserBrief] = None
    duration_minutes: Optional[int] = None
    
    class Config:
        from_attributes = True


class ShowroomCurrentResponse(BaseModel):
    """Response for current showroom customers"""
    total: int
    visits: list[ShowroomVisitResponse]


class ShowroomHistoryResponse(BaseModel):
    """Paginated response for showroom history"""
    items: list[ShowroomVisitResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
