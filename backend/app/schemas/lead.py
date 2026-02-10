"""
Pydantic Schemas for Lead (sales opportunity).
Contact info now lives on Customer; pipeline stage on LeadStage.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.lead import LeadSource
from app.schemas.customer import CustomerBrief
from app.schemas.lead_stage import LeadStageResponse
from app.schemas.user import UserBrief


class LeadCreate(BaseModel):
    """
    Schema for creating a lead.
    Provide customer contact info (phone/email/name) — backend will
    find-or-create the customer automatically. Or set link_customer_id
    to link the lead to an existing customer (e.g. after match prompt).
    """
    # Optional: link to existing customer (skip find_or_create for primary)
    link_customer_id: Optional[UUID] = None
    # Customer identification (used for find_or_create_customer when link_customer_id not set)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = None
    alternate_phone: Optional[str] = Field(None, max_length=20)
    # Customer address / personal (optional, passed to customer)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    company: Optional[str] = None
    job_title: Optional[str] = None
    preferred_contact_method: Optional[str] = None
    preferred_contact_time: Optional[str] = None

    # Lead-specific
    source: LeadSource = LeadSource.MANUAL
    notes: Optional[str] = None
    meta_data: Dict[str, Any] = Field(default_factory=dict)
    interested_in: Optional[str] = None
    budget_range: Optional[str] = None
    dealership_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None
    secondary_customer_id: Optional[UUID] = None

    @field_validator(
        "last_name", "phone", "alternate_phone", "notes",
        "interested_in", "budget_range", "address", "city", "state",
        "postal_code", "country", "company", "job_title",
        "preferred_contact_method", "preferred_contact_time",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, v: Any) -> Any:
        if v == "" or v is None:
            return None
        return v


class LeadUpdate(BaseModel):
    """Schema for updating lead-specific fields (not contact info)."""
    notes: Optional[str] = None
    meta_data: Optional[Dict[str, Any]] = None
    interested_in: Optional[str] = None
    budget_range: Optional[str] = None
    secondary_customer_id: Optional[UUID] = None

    @field_validator("notes", "interested_in", "budget_range", mode="before")
    @classmethod
    def empty_string_to_none(cls, v: Any) -> Any:
        if v == "" or v is None:
            return None
        return v


class LeadStageChangeRequest(BaseModel):
    """Schema for changing lead stage (replaces LeadStatusUpdate)."""
    stage_id: UUID
    notes: Optional[str] = None
    confirm_skate: bool = False


class LeadAssignment(BaseModel):
    """Schema for lead assignment (primary salesperson)."""
    assigned_to: UUID
    secondary_salesperson_id: Optional[UUID] = None
    notes: Optional[str] = None


class LeadSecondaryAssignment(BaseModel):
    """Schema for assigning secondary salesperson (Admin only)."""
    secondary_salesperson_id: Optional[UUID] = None
    notes: Optional[str] = None


class LeadSwapSalespersons(BaseModel):
    """Schema for swapping primary and secondary salespersons."""
    notes: Optional[str] = None


class LeadDealershipAssignment(BaseModel):
    """Schema for assigning lead to dealership."""
    dealership_id: UUID
    notes: Optional[str] = None


class BulkLeadDealershipAssignment(BaseModel):
    """Schema for bulk assigning leads to dealership."""
    lead_ids: List[UUID]
    dealership_id: UUID
    notes: Optional[str] = None


class DealershipBrief(BaseModel):
    """Brief dealership info for responses."""
    id: UUID
    name: str

    class Config:
        from_attributes = True


class LeadResponse(BaseModel):
    """Lead response — contact info comes from embedded customer."""
    id: UUID
    # Customer (embedded brief)
    customer_id: UUID
    customer: Optional[CustomerBrief] = None
    secondary_customer_id: Optional[UUID] = None
    secondary_customer: Optional[CustomerBrief] = None
    # Stage (embedded)
    stage_id: UUID
    stage: Optional[LeadStageResponse] = None
    # Lead fields
    source: LeadSource
    is_active: bool
    outcome: Optional[str] = None
    interest_score: int = 0
    dealership_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None
    secondary_salesperson_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    notes: Optional[str] = None
    meta_data: Dict[str, Any] = Field(default_factory=dict)
    external_id: Optional[str] = None
    interested_in: Optional[str] = None
    budget_range: Optional[str] = None
    # Timestamps
    first_contacted_at: Optional[datetime] = None
    last_contacted_at: Optional[datetime] = None
    converted_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # Convenience: flattened customer fields for backward compat
    @property
    def first_name(self) -> str:
        return self.customer.first_name if self.customer else ""

    @property
    def last_name(self) -> Optional[str]:
        return self.customer.last_name if self.customer else None

    @property
    def full_name(self) -> Optional[str]:
        return self.customer.full_name if self.customer else None

    @property
    def phone(self) -> Optional[str]:
        return self.customer.phone if self.customer else None

    @property
    def email(self) -> Optional[str]:
        return self.customer.email if self.customer else None

    class Config:
        from_attributes = True


class LeadBrief(BaseModel):
    """Brief lead info for lists."""
    id: UUID
    customer: Optional[CustomerBrief] = None
    stage: Optional[LeadStageResponse] = None
    source: LeadSource
    is_active: bool = True

    class Config:
        from_attributes = True


class LeadDetail(LeadResponse):
    """Detailed lead response with related user and dealership info."""
    assigned_to_user: Optional[UserBrief] = None
    secondary_salesperson: Optional[UserBrief] = None
    created_by_user: Optional[UserBrief] = None
    dealership: Optional[DealershipBrief] = None
    access_level: Optional[str] = None


class LeadListResponse(BaseModel):
    """Paginated lead list response."""
    items: List[LeadResponse]
    total: int
    page: int
    page_size: int
    pages: int
