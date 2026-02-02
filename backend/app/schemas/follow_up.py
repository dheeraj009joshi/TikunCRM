"""
Pydantic Schemas for Follow-Up and Schedule
"""
from datetime import datetime, time
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.follow_up import FollowUpStatus
from app.schemas.user import UserBrief
from app.schemas.lead import LeadBrief


# Follow-Up Schemas
class FollowUpBase(BaseModel):
    """Base follow-up schema"""
    scheduled_at: datetime
    notes: Optional[str] = None


class FollowUpCreate(FollowUpBase):
    """Schema for creating a follow-up"""
    lead_id: UUID


class FollowUpUpdate(BaseModel):
    """Schema for updating a follow-up"""
    scheduled_at: Optional[datetime] = None
    notes: Optional[str] = None
    status: Optional[FollowUpStatus] = None
    completion_notes: Optional[str] = None


class FollowUpResponse(FollowUpBase):
    """Schema for follow-up response"""
    id: UUID
    lead_id: UUID
    assigned_to: UUID
    status: FollowUpStatus
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Enriched fields
    lead: Optional[LeadBrief] = None
    assigned_to_user: Optional[UserBrief] = None
    
    class Config:
        from_attributes = True


# Schedule Schemas
class ScheduleBase(BaseModel):
    """Base schedule schema"""
    day_of_week: int = Field(..., ge=0, le=6)
    start_time: time
    end_time: time
    is_available: bool = True


class ScheduleCreate(ScheduleBase):
    """Schema for creating a schedule entry"""
    pass


class ScheduleResponse(ScheduleBase):
    """Schema for schedule response"""
    id: UUID
    user_id: UUID
    
    class Config:
        from_attributes = True


class ScheduleUpdate(BaseModel):
    """Schema for updating a schedule"""
    schedules: List[ScheduleCreate]
