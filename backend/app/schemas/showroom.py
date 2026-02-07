"""
Pydantic Schemas for Showroom Visits
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
    """Brief lead info for showroom responses"""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    
    class Config:
        from_attributes = True


class UserBrief(BaseModel):
    """Brief user info for showroom responses"""
    id: UUID
    first_name: str
    last_name: str
    
    class Config:
        from_attributes = True


class ShowroomVisitResponse(BaseModel):
    """Response for a showroom visit"""
    id: UUID
    lead_id: UUID
    appointment_id: Optional[UUID] = None
    dealership_id: UUID
    checked_in_at: datetime
    checked_out_at: Optional[datetime] = None
    checked_in_by: UUID
    checked_out_by: Optional[UUID] = None
    outcome: Optional[ShowroomOutcome] = None
    notes: Optional[str] = None
    is_checked_in: bool
    # Related data
    lead: Optional[LeadBrief] = None
    checked_in_by_user: Optional[UserBrief] = None
    checked_out_by_user: Optional[UserBrief] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ShowroomCurrentResponse(BaseModel):
    """Response for current showroom occupancy"""
    count: int
    visits: list[ShowroomVisitResponse]


class ShowroomHistoryResponse(BaseModel):
    """Paginated response for showroom history"""
    items: list[ShowroomVisitResponse]
    total: int
    page: int
    page_size: int


class ShowroomStats(BaseModel):
    """Dashboard stats for showroom"""
    currently_in_showroom: int
    checked_in_today: int
    sold_today: int
    avg_visit_duration_minutes: Optional[float] = None
