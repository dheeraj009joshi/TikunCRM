"""
Pydantic Schemas for LeadStage
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class LeadStageCreate(BaseModel):
    """Schema for creating a pipeline stage."""
    name: str = Field(..., min_length=1, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    order: int = 0
    color: Optional[str] = Field(None, max_length=20)
    dealership_id: Optional[UUID] = None
    is_terminal: bool = False


class LeadStageUpdate(BaseModel):
    """Schema for updating a pipeline stage."""
    display_name: Optional[str] = Field(None, max_length=100)
    color: Optional[str] = Field(None, max_length=20)
    is_terminal: Optional[bool] = None
    is_active: Optional[bool] = None


class LeadStageReorder(BaseModel):
    """Schema for reordering stages (drag-drop)."""
    ordered_ids: List[UUID]


class LeadStageResponse(BaseModel):
    """Pipeline stage response."""
    id: UUID
    name: str
    display_name: str
    order: int
    color: Optional[str] = None
    dealership_id: Optional[UUID] = None
    is_terminal: bool
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
