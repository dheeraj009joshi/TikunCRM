"""
Pydantic Schemas for Auto WhatsApp - Selenium-based bulk messaging.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.auto_whatsapp import (
    AutoWhatsAppProfileStatus,
    AutoWhatsAppJobStatus,
    AutoWhatsAppLogAction,
)


# ======================= PROFILE SCHEMAS =======================

class AutoWhatsAppProfileResponse(BaseModel):
    """Response schema for WhatsApp profile"""
    id: UUID
    dealership_id: UUID
    dealership_name: Optional[str] = None
    phone_number: Optional[str] = None
    status: str
    last_connected_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AutoWhatsAppProfileSetupResponse(BaseModel):
    """Response when starting profile setup (QR code generation)"""
    profile_id: UUID
    status: str
    message: str
    qr_code_base64: Optional[str] = None


class AutoWhatsAppProfileStatusResponse(BaseModel):
    """Response for profile connection status check"""
    profile_id: UUID
    status: str
    phone_number: Optional[str] = None
    is_connected: bool
    error_message: Optional[str] = None


# ======================= LEAD PREVIEW SCHEMAS =======================

class LeadPreviewFilter(BaseModel):
    """Filters for selecting leads for bulk send"""
    stage_ids: Optional[List[UUID]] = Field(None, description="Filter by pipeline stages")
    campaign_ids: Optional[List[UUID]] = Field(None, description="Filter by campaign mappings")
    source: Optional[str] = Field(None, description="Filter by lead source")
    salesperson_id: Optional[UUID] = Field(None, description="Filter by assigned salesperson")
    is_active: Optional[bool] = Field(None, description="Filter by active status")
    has_phone: bool = Field(True, description="Only include leads with phone numbers")
    created_after: Optional[datetime] = Field(None, description="Created after date")
    created_before: Optional[datetime] = Field(None, description="Created before date")
    search: Optional[str] = Field(None, description="Search in name, phone, email")


class LeadPreviewItem(BaseModel):
    """Lead item in preview list"""
    id: UUID
    first_name: str
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    stage_name: Optional[str] = None
    stage_color: Optional[str] = None
    source: Optional[str] = None
    interested_in: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class LeadPreviewResponse(BaseModel):
    """Response for lead preview query"""
    leads: List[LeadPreviewItem]
    total_count: int
    has_phone_count: int
    missing_phone_count: int


# ======================= JOB SCHEMAS =======================

class AutoWhatsAppJobCreate(BaseModel):
    """Request to create a new bulk send job"""
    name: str = Field(..., min_length=1, max_length=255, description="Job name")
    message_text: str = Field(
        ...,
        min_length=1,
        max_length=4096,
        description="Message template with placeholders like {{first_name}}"
    )
    lead_ids: List[UUID] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="List of lead IDs to send messages to"
    )
    filter_criteria: Optional[Dict[str, Any]] = Field(
        None,
        description="Original filters used (for reference)"
    )


class AutoWhatsAppJobResponse(BaseModel):
    """Response schema for a job"""
    id: UUID
    dealership_id: UUID
    profile_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    name: str
    message_text: str
    status: str
    total_leads: int
    sent_count: int
    failed_count: int
    remaining_count: int
    progress_percent: float
    current_index: int
    error_count: int
    started_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AutoWhatsAppJobDetailResponse(AutoWhatsAppJobResponse):
    """Detailed job response including errors and lead IDs"""
    lead_ids: List[str]
    filter_criteria: Optional[Dict[str, Any]] = None
    errors: List[Dict[str, Any]]
    logs: List["AutoWhatsAppJobLogResponse"]


class AutoWhatsAppJobListResponse(BaseModel):
    """Paginated list of jobs"""
    jobs: List[AutoWhatsAppJobResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AutoWhatsAppJobLogResponse(BaseModel):
    """Response schema for job log entry"""
    id: UUID
    job_id: UUID
    action: str
    message: str
    meta_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ======================= JOB ACTION SCHEMAS =======================

class AutoWhatsAppJobActionResponse(BaseModel):
    """Response for job actions (pause, resume, cancel)"""
    job_id: UUID
    status: str
    message: str
    sent_count: int
    failed_count: int


# ======================= WEBSOCKET MESSAGE SCHEMAS =======================

class WSProgressMessage(BaseModel):
    """WebSocket progress update message"""
    type: str = "progress"
    job_id: str
    status: str
    sent: int
    failed: int
    total: int
    current_index: int
    current_lead_name: Optional[str] = None
    percent: float


class WSErrorMessage(BaseModel):
    """WebSocket error message"""
    type: str = "error"
    job_id: str
    lead_id: str
    lead_name: Optional[str] = None
    phone: Optional[str] = None
    error: str
    timestamp: str


class WSStateChangeMessage(BaseModel):
    """WebSocket job state change message"""
    type: str  # paused, resumed, completed, cancelled, failed
    job_id: str
    status: str
    sent: int
    failed: int
    message: Optional[str] = None
    duration_seconds: Optional[int] = None


# Update forward references
AutoWhatsAppJobDetailResponse.model_rebuild()
