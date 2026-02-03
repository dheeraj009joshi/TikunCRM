"""
Authentication Schemas
"""
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import UserResponse
from app.schemas.dealership import DealershipBrief


class LoginRequest(BaseModel):
    """Login request schema"""
    email: EmailStr
    password: str


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
