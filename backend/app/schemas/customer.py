"""
Pydantic Schemas for Customer
"""
import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, BeforeValidator


def validate_optional_email(v: Any) -> Optional[str]:
    if v == "" or v is None:
        return None
    if isinstance(v, str):
        email_pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
        if not re.match(email_pattern, v):
            raise ValueError("Invalid email format")
    return v


OptionalEmail = Annotated[Optional[str], BeforeValidator(validate_optional_email)]


class CustomerCreate(BaseModel):
    """Schema for creating a customer (or during lead creation)."""
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    email: OptionalEmail = None
    alternate_phone: Optional[str] = Field(None, max_length=20)
    whatsapp: Optional[str] = Field(None, max_length=20)
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

    @field_validator(
        "last_name", "phone", "alternate_phone", "whatsapp",
        "address", "city", "state", "postal_code", "country",
        "company", "job_title", "preferred_contact_method", "preferred_contact_time",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, v: Any) -> Any:
        if v == "" or v is None:
            return None
        return v


class CustomerUpdate(BaseModel):
    """Schema for updating customer info."""
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    email: OptionalEmail = None
    alternate_phone: Optional[str] = Field(None, max_length=20)
    whatsapp: Optional[str] = Field(None, max_length=20)
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

    @field_validator(
        "first_name", "last_name", "phone", "alternate_phone", "whatsapp",
        "address", "city", "state", "postal_code", "country",
        "company", "job_title", "preferred_contact_method", "preferred_contact_time",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, v: Any) -> Any:
        if v == "" or v is None:
            return None
        return v


class CustomerBrief(BaseModel):
    """Brief customer info embedded in lead responses."""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True


class CustomerResponse(BaseModel):
    """Full customer response."""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    alternate_phone: Optional[str] = None
    whatsapp: Optional[str] = None
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
    source_first_touch: Optional[str] = None
    lifetime_value: Decimal = Decimal("0")
    meta_data: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomerListResponse(BaseModel):
    """Paginated customer list."""
    items: List[CustomerResponse]
    total: int
    page: int
    page_size: int
    pages: int


class Customer360Response(CustomerResponse):
    """Customer 360 view — includes all leads."""
    leads: List[Any] = Field(default_factory=list)  # LeadResponse objects
    total_leads: int = 0
    active_leads: int = 0
