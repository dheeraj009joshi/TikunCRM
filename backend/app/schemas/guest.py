"""
Pydantic Schemas for Guest profiles.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.eligibility import AssessmentResponse


class GuestCreate(BaseModel):
    """Create a guest, usually from an appointment. Snapshot fields are optional;
    the server auto-fills from the lead/customer when omitted."""
    appointment_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    customer_id: Optional[UUID] = None
    dealership_id: Optional[UUID] = None

    full_name: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    down_payment: Optional[Decimal] = None
    vehicle_of_interest: Optional[str] = Field(None, max_length=255)
    trade_in: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class GuestUpdate(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    down_payment: Optional[Decimal] = None
    vehicle_of_interest: Optional[str] = Field(None, max_length=255)
    trade_in: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    status: Optional[str] = Field(None, max_length=20)


class GuestDocument(BaseModel):
    """A document on file for the guest (sourced from the linked lead's Stips)."""
    id: UUID
    category_name: str
    file_name: str
    content_type: str
    uploaded_at: datetime


class GuestResponse(BaseModel):
    id: UUID
    dealership_id: Optional[UUID] = None
    appointment_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    customer_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    down_payment: Optional[Decimal] = None
    vehicle_of_interest: Optional[str] = None
    trade_in: Optional[str] = None
    notes: Optional[str] = None
    share_token: Optional[str] = None
    share_revoked: bool = False
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GuestShareResponse(BaseModel):
    share_token: str
    share_url: str


class GuestPublicResponse(BaseModel):
    """Full guest profile rendered on the public (scanned) page."""
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    down_payment: Optional[Decimal] = None
    vehicle_of_interest: Optional[str] = None
    trade_in: Optional[str] = None
    notes: Optional[str] = None
    status: str
    dealership_name: Optional[str] = None
    appointment_at: Optional[datetime] = None
    eligibility: Optional[AssessmentResponse] = None
    documents: List[GuestDocument] = Field(default_factory=list)
