"""
Pydantic Schemas for User
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.core.permissions import UserRole


# Base schemas
class UserBase(BaseModel):
    """Base user schema"""
    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)


class UserCreate(UserBase):
    """Schema for creating a user"""
    password: str = Field(..., min_length=6)
    role: UserRole = UserRole.SALESPERSON
    dealership_id: Optional[UUID] = None


class UserUpdate(BaseModel):
    """Schema for updating a user"""
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    avatar_url: Optional[str] = None
    is_active: Optional[bool] = None
    dealership_email: Optional[str] = Field(None, max_length=255, description="Deprecated: Use smtp_email")


class UserPasswordUpdate(BaseModel):
    """Schema for password update"""
    current_password: str
    new_password: str = Field(..., min_length=8)


# ===== User Email Configuration Schemas =====
class UserEmailConfigUpdate(BaseModel):
    """Schema for updating user's email configuration"""
    # Simple: just email and password - used for both SMTP and IMAP
    email: str = Field(..., description="Your Hostinger email (e.g., john@dealership.com)")
    password: str = Field(..., min_length=1, description="Your email password")


class UserEmailConfigResponse(BaseModel):
    """Response schema for user's email config (password hidden)"""
    email: Optional[str] = None
    email_config_verified: bool = False
    has_password: bool = False
    last_sync_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class ViewEmailPasswordRequest(BaseModel):
    """Request to view encrypted email password"""
    account_password: str = Field(..., description="Your CRM account password to verify identity")


class ViewEmailPasswordResponse(BaseModel):
    """Response with decrypted email password"""
    password: str


class TestEmailConfigRequest(BaseModel):
    """Request to test email configuration"""
    test_email: str = Field(..., description="Email address to send test email to")


class UserResponse(UserBase):
    """Schema for user response"""
    id: UUID
    role: UserRole
    dealership_id: Optional[UUID] = None
    is_active: bool
    is_verified: bool
    avatar_url: Optional[str] = None
    dealership_email: Optional[str] = None  # Deprecated
    smtp_email: Optional[str] = None
    email_config_verified: bool = False
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class UserBrief(BaseModel):
    """Brief user info for lists"""
    id: UUID
    email: EmailStr
    first_name: str
    last_name: str
    role: UserRole
    is_active: bool = True
    dealership_id: Optional[UUID] = None
    smtp_email: Optional[str] = None
    email_config_verified: bool = False
    
    class Config:
        from_attributes = True


class UserWithStats(UserBrief):
    """User with performance stats for team management"""
    total_leads: int = 0
    active_leads: int = 0
    converted_leads: int = 0
    conversion_rate: float = 0.0
    
    class Config:
        from_attributes = True


class TeamListResponse(BaseModel):
    """Team list with stats"""
    items: list[UserWithStats]
    total: int
    dealership_id: Optional[UUID] = None
    dealership_name: Optional[str] = None
