"""
Pydantic schemas for Dealership Email Configuration
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, EmailStr


class DealershipEmailConfigBase(BaseModel):
    """Base schema with common fields"""
    smtp_host: str = Field(..., min_length=1, max_length=255, description="SMTP server hostname")
    smtp_port: int = Field(465, ge=1, le=65535, description="SMTP port (465 for SSL, 587 for TLS)")
    smtp_username: str = Field(..., min_length=1, max_length=255, description="SMTP username")
    smtp_use_ssl: bool = Field(True, description="Use SSL (for port 465)")
    smtp_use_tls: bool = Field(False, description="Use STARTTLS (for port 587)")
    
    # Optional IMAP settings
    imap_host: Optional[str] = Field(None, max_length=255, description="IMAP server hostname")
    imap_port: int = Field(993, ge=1, le=65535, description="IMAP port (usually 993)")
    imap_username: Optional[str] = Field(None, max_length=255, description="IMAP username")
    imap_use_ssl: bool = Field(True, description="Use SSL for IMAP")
    
    # Display settings
    from_name: Optional[str] = Field(None, max_length=255, description="Default display name for emails")


class DealershipEmailConfigCreate(DealershipEmailConfigBase):
    """Schema for creating a new email configuration"""
    smtp_password: str = Field(..., min_length=1, description="SMTP password")
    imap_password: Optional[str] = Field(None, description="IMAP password (defaults to SMTP password)")


class DealershipEmailConfigUpdate(BaseModel):
    """Schema for updating email configuration - all fields optional"""
    smtp_host: Optional[str] = Field(None, min_length=1, max_length=255)
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_username: Optional[str] = Field(None, min_length=1, max_length=255)
    smtp_password: Optional[str] = Field(None, min_length=1, description="New password (leave empty to keep existing)")
    smtp_use_ssl: Optional[bool] = None
    smtp_use_tls: Optional[bool] = None
    
    imap_host: Optional[str] = Field(None, max_length=255)
    imap_port: Optional[int] = Field(None, ge=1, le=65535)
    imap_username: Optional[str] = Field(None, max_length=255)
    imap_password: Optional[str] = Field(None, description="New IMAP password")
    imap_use_ssl: Optional[bool] = None
    
    from_name: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class DealershipEmailConfigResponse(BaseModel):
    """Schema for email configuration response - excludes passwords"""
    id: UUID
    dealership_id: UUID
    
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_use_ssl: bool
    smtp_use_tls: bool
    
    imap_host: Optional[str]
    imap_port: int
    imap_username: Optional[str]
    imap_use_ssl: bool
    
    from_name: Optional[str]
    
    is_verified: bool
    is_active: bool
    last_sync_at: Optional[datetime]
    
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class EmailTestRequest(BaseModel):
    """Schema for testing email configuration"""
    test_email: EmailStr = Field(..., description="Email address to send test email to")


class EmailTestResponse(BaseModel):
    """Response from email test"""
    success: bool
    message: str
    details: Optional[str] = None


class EmailConfigStatusResponse(BaseModel):
    """Status of dealership email configuration"""
    has_config: bool
    is_verified: bool
    is_active: bool
    smtp_host: Optional[str] = None
    last_sync_at: Optional[datetime] = None
