"""
Pydantic Schemas for Email Templates
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.email_template import TemplateCategory


class EmailTemplateCreate(BaseModel):
    """Schema for creating an email template"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    category: TemplateCategory = TemplateCategory.CUSTOM
    subject: str = Field(..., min_length=1, max_length=500)
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    available_variables: List[str] = []


class EmailTemplateUpdate(BaseModel):
    """Schema for updating an email template"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[TemplateCategory] = None
    subject: Optional[str] = Field(None, min_length=1, max_length=500)
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    available_variables: Optional[List[str]] = None
    is_active: Optional[bool] = None


class EmailTemplateResponse(BaseModel):
    """Schema for email template response"""
    id: UUID
    name: str
    description: Optional[str]
    category: TemplateCategory
    subject: str
    body_text: Optional[str]
    body_html: Optional[str]
    available_variables: List[str]
    is_system: bool
    dealership_id: Optional[UUID]
    created_by: Optional[UUID]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class EmailTemplateListResponse(BaseModel):
    """Paginated email template list"""
    items: List[EmailTemplateResponse]
    total: int
    page: int
    page_size: int


# Email compose schemas
class EmailComposeRequest(BaseModel):
    """Schema for composing and sending an email"""
    to_email: str
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    subject: str
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    template_id: Optional[UUID] = None  # If using a template
    lead_id: Optional[UUID] = None  # Associate with a lead


class EmailSendResponse(BaseModel):
    """Response after sending an email"""
    success: bool
    message: str
    email_log_id: Optional[UUID] = None
    gmail_message_id: Optional[str] = None


class EmailPreviewRequest(BaseModel):
    """Request to preview an email with variables replaced"""
    template_id: Optional[UUID] = None
    subject: Optional[str] = None
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    lead_id: Optional[UUID] = None  # To get lead variables


class EmailPreviewResponse(BaseModel):
    """Previewed email with variables replaced"""
    subject: str
    body_text: Optional[str]
    body_html: Optional[str]
    to_email: Optional[str]
    lead_name: Optional[str]
