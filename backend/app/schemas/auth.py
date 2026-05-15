"""
Authentication Schemas
"""
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import UserResponse
from app.schemas.dealership import DealershipBrief


class LoginRequest(BaseModel):
    """Login request schema"""
    email: EmailStr
    password: str
    dealership_id: Optional[UUID] = None


# ============== Dealership lookup (multi-dealership login) ==============

class DealershipLookupRequest(BaseModel):
    """Request the list of dealerships an email is registered with."""
    email: EmailStr


class DealershipLookupOption(BaseModel):
    """A single dealership a given email belongs to."""
    id: Optional[UUID] = None  # None for super admin (no dealership)
    name: str
    is_super_admin: bool = False


class DealershipLookupResponse(BaseModel):
    """Result of /auth/lookup-dealerships."""
    dealerships: List[DealershipLookupOption]


class DealershipRequiredDetail(BaseModel):
    """409 detail body returned when an email matches multiple dealerships."""
    code: str = "dealership_required"
    message: str
    dealerships: List[DealershipLookupOption]


class SwitchDealershipRequest(BaseModel):
    """Switch the active session to another dealership account with the same email."""
    dealership_id: Optional[UUID] = Field(
        None,
        description="Target dealership UUID. Omit or null for super admin account.",
    )


class RefreshTokenRequest(BaseModel):
    """Refresh token request"""
    refresh_token: str


class Token(BaseModel):
    """Token response"""
    access_token: str
    refresh_token: str
    token_type: str
    user: Optional[UserResponse] = None
    
    class Config:
        from_attributes = True


class TokenResponse(Token):
    """Alias for Token to match naming conventions"""
    pass


class TokenPayload(BaseModel):
    """JWT Token payload"""
    sub: Optional[str] = None
    exp: Optional[int] = None
    role: Optional[str] = None


class CurrentUser(UserResponse):
    """Current authenticated user"""
    pass


class SignupRequest(BaseModel):
    """Signup request schema"""
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=100)
    dealership_name: str = Field(..., min_length=1, max_length=255)


class SignupResponse(BaseModel):
    """Signup response schema"""
    message: str
    user: UserResponse
    dealership: DealershipBrief
    access_token: str
    refresh_token: str
    token_type: str
    
    class Config:
        from_attributes = True


# ============== Password Reset Schemas ==============

class ForgotPasswordRequest(BaseModel):
    """Request to initiate password reset"""
    email: EmailStr
    # Required when the email exists in multiple dealerships. If omitted and the
    # email matches more than one user, the API responds 409 dealership_required.
    dealership_id: Optional[UUID] = None


class ForgotPasswordResponse(BaseModel):
    """Response after password reset email sent"""
    message: str
    success: bool = True


class ResetPasswordRequest(BaseModel):
    """Request to reset password with token"""
    token: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=100)
    
    @field_validator('new_password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v


class ResetPasswordResponse(BaseModel):
    """Response after password reset"""
    message: str
    success: bool = True


class ChangePasswordRequest(BaseModel):
    """Request to change password (authenticated user)"""
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=100)
    
    @field_validator('new_password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v


class ChangePasswordResponse(BaseModel):
    """Response after password change"""
    message: str
    success: bool = True


# ============== Configuration access (second password for integration secrets) ==============

class ConfigAccessStatusResponse(BaseModel):
    """Whether the user may use / must set a configuration-access password."""
    eligible: bool
    config_access_password_set: bool


class ConfigAccessVerifyRequest(BaseModel):
    """Unlock sensitive configuration APIs for a short time."""
    config_password: str = Field(..., min_length=1)


class ConfigAccessUnlockResponse(BaseModel):
    unlock_token: str
    expires_in: int  # seconds
