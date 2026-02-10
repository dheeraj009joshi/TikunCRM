"""
Pydantic Schemas for Appointments
"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.appointment import AppointmentType, AppointmentStatus


# ============== Base Schemas ==============

class AppointmentBase(BaseModel):
    """Base appointment schema"""
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    appointment_type: AppointmentType = AppointmentType.IN_PERSON
    scheduled_at: datetime
    duration_minutes: int = Field(30, ge=5, le=480)
    location: Optional[str] = Field(None, max_length=500)
    meeting_link: Optional[str] = Field(None, max_length=500)


class AppointmentCreate(AppointmentBase):
    """Schema for creating an appointment"""
    lead_id: UUID  # Required - every appointment must be linked to a lead
    assigned_to: Optional[UUID] = None
    confirm_skate: bool = False  # If True, user confirmed they want to proceed despite SKATE warning


class AppointmentUpdate(BaseModel):
    """Schema for updating an appointment"""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    appointment_type: Optional[AppointmentType] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    location: Optional[str] = Field(None, max_length=500)
    meeting_link: Optional[str] = Field(None, max_length=500)
    status: Optional[AppointmentStatus] = None
    assigned_to: Optional[UUID] = None


class AppointmentComplete(BaseModel):
    """Schema for completing an appointment"""
    outcome_notes: Optional[str] = None
    status: AppointmentStatus = AppointmentStatus.COMPLETED


class AppointmentCancel(BaseModel):
    """Schema for cancelling an appointment"""
    reason: Optional[str] = None


# ============== Response Schemas ==============

class UserBrief(BaseModel):
    """Brief user info for appointments"""
    id: UUID
    first_name: str
    last_name: str
    email: str
    
    class Config:
        from_attributes = True


class CustomerBrief(BaseModel):
    """Brief customer info for appointment lead display."""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True


class LeadBrief(BaseModel):
    """Brief lead info for appointments (contact details come from lead.customer)."""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    customer: Optional[CustomerBrief] = None

    class Config:
        from_attributes = True


class DealershipBrief(BaseModel):
    """Brief dealership info"""
    id: UUID
    name: str
    
    class Config:
        from_attributes = True


class AppointmentResponse(AppointmentBase):
    """Full appointment response"""
    id: UUID
    lead_id: Optional[UUID] = None
    dealership_id: Optional[UUID] = None
    scheduled_by: Optional[UUID] = None
    assigned_to: Optional[UUID] = None
    status: AppointmentStatus
    reminder_sent: bool
    outcome_notes: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    # Nested objects (optional, included when loaded)
    lead: Optional[LeadBrief] = None
    dealership: Optional[DealershipBrief] = None
    scheduled_by_user: Optional[UserBrief] = None
    assigned_to_user: Optional[UserBrief] = None
    
    class Config:
        from_attributes = True


class AppointmentListResponse(BaseModel):
    """Paginated list of appointments"""
    items: List[AppointmentResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AppointmentStats(BaseModel):
    """Appointment statistics for dashboard"""
    today: int
    upcoming: int
    overdue: int
    completed_this_week: int
    cancelled_this_week: int
    total_scheduled: int


# ============== Filter Schemas ==============

class AppointmentFilter(BaseModel):
    """Filter options for listing appointments"""
    status: Optional[AppointmentStatus] = None
    appointment_type: Optional[AppointmentType] = None
    lead_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    today_only: bool = False
    upcoming_only: bool = False
    overdue_only: bool = False
