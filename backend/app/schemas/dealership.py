"""
Pydantic Schemas for Dealership
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserBrief


class WorkingHours(BaseModel):
    """Working hours for a day"""
    start: str = Field(..., pattern=r"^\d{2}:\d{2}$")  # HH:MM format
    end: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    is_open: bool = True


class LeadAssignmentRules(BaseModel):
    """Lead assignment configuration"""
    auto_assign: bool = False
    round_robin: bool = True
    max_leads_per_salesperson: int = 50


class DealershipBase(BaseModel):
    """Base dealership schema"""
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[EmailStr] = None
    website: Optional[str] = None
    timezone: Optional[str] = Field(None, description="IANA timezone name (e.g., 'America/New_York', 'Europe/London')")


class OwnerCreate(BaseModel):
    """Owner information for new dealership"""
    email: EmailStr
    password: str = Field(..., min_length=6)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)


class DealershipCreate(DealershipBase):
    """Schema for creating a dealership"""
    config: Dict[str, Any] = Field(default_factory=dict)
    working_hours: Dict[str, WorkingHours] = Field(default_factory=dict)
    lead_assignment_rules: LeadAssignmentRules = Field(
        default_factory=LeadAssignmentRules
    )
    owner: Optional[OwnerCreate] = Field(None, description="Owner details - creates a dealership owner user")


class DealershipUpdate(BaseModel):
    """Schema for updating a dealership"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[EmailStr] = None
    website: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    working_hours: Optional[Dict[str, WorkingHours]] = None
    lead_assignment_rules: Optional[LeadAssignmentRules] = None
    is_active: Optional[bool] = None


class DealershipResponse(DealershipBase):
    """Schema for dealership response"""
    id: UUID
    config: Dict[str, Any]
    working_hours: Dict[str, Any]
    lead_assignment_rules: Dict[str, Any]
    timezone: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class DealershipWithUsers(DealershipResponse):
    """Dealership with users list"""
    users: List[UserBrief] = []


class DealershipBrief(BaseModel):
    """Brief dealership info"""
    id: UUID
    name: str
    is_active: bool
    
    class Config:
        from_attributes = True
