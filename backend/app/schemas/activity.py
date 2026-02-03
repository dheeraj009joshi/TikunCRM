"""
Pydantic Schemas for Activity
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.activity import ActivityType
from app.schemas.user import UserBrief


class ActivityCreate(BaseModel):
    """Schema for creating an activity (internal use)"""
    type: ActivityType
    description: str
    user_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    dealership_id: Optional[UUID] = None
    meta_data: Dict[str, Any] = {}
    ip_address: Optional[str] = None


class ActivityResponse(BaseModel):
    """Schema for activity response"""
    id: UUID
    type: ActivityType
    description: str
    user_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    dealership_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None
    meta_data: Dict[str, Any]
    created_at: datetime
    
    class Config:
        from_attributes = True


class ActivityWithUser(ActivityResponse):
    """Activity with user info"""
    user: Optional[UserBrief] = None


class ActivityListResponse(BaseModel):
    """Paginated activity list response"""
    items: List[ActivityWithUser]
    total: int
    page: int
    page_size: int


class NoteCreate(BaseModel):
    """Schema for adding a note to a lead"""
    content: str = Field(..., min_length=1, max_length=5000)
    parent_id: Optional[UUID] = None  # For replies to existing notes
    mentioned_user_ids: Optional[List[UUID]] = None  # For @mentions
