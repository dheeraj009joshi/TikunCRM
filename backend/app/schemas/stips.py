"""
Pydantic Schemas for Stips categories and documents.
"""
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class StipsCategoryCreate(BaseModel):
    """Schema for creating a Stips category."""
    name: str = Field(..., min_length=1, max_length=100)
    display_order: int = 0
    scope: Literal["customer", "lead"] = "lead"
    dealership_id: Optional[UUID] = None


class StipsCategoryUpdate(BaseModel):
    """Schema for updating a Stips category."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    display_order: Optional[int] = None
    scope: Optional[Literal["customer", "lead"]] = None


class StipsCategoryReorder(BaseModel):
    """Schema for reordering categories."""
    ordered_ids: List[UUID]


class StipsCategoryResponse(BaseModel):
    """Stips category response."""
    id: UUID
    name: str
    display_order: int
    scope: str
    dealership_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# Document list item (aggregated from customer_stip_documents and lead_stip_documents)
class StipDocumentResponse(BaseModel):
    """Single document in list (customer- or lead-scoped)."""
    id: UUID
    category_id: UUID
    category_name: str
    scope: str  # "customer" | "lead"
    file_name: str
    content_type: str
    file_size: Optional[int] = None
    uploaded_at: datetime
    uploaded_by_name: Optional[str] = None
    # For customer docs: which customer (primary/secondary) for UI label
    customer_scope: Optional[Literal["primary", "secondary"]] = None


class StipDocumentViewUrl(BaseModel):
    """Response for view endpoint - URL to open in new tab."""
    url: str
