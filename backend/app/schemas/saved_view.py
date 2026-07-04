"""Saved view schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class SavedViewBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    entity_type: str = Field("leads", max_length=50)
    filters: Dict[str, Any] = Field(default_factory=dict)
    columns: Optional[List[str]] = None
    sort: Optional[Dict[str, Any]] = None
    is_default: bool = False


class SavedViewCreate(SavedViewBase):
    pass


class SavedViewUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    filters: Optional[Dict[str, Any]] = None
    columns: Optional[List[str]] = None
    sort: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None


class SavedViewResponse(SavedViewBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
