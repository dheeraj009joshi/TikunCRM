"""
Authentication Endpoints - Enhanced with Signup and Password Reset
"""
from datetime import datetime, timedelta
from typing import Any
import logging

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token, verify_password, get_password_hash, verify_token
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User, UserRole
from app.models.dealership import Dealership
from app.models.password_reset import PasswordResetToken
from app.schemas.auth import (
    Token, SignupRequest, SignupResponse, RefreshTokenRequest,
    ForgotPasswordRequest, ForgotPasswordResponse,
    ResetPasswordRequest, ResetPasswordResponse,
    ChangePasswordRequest, ChangePasswordResponse
)
from app.schemas.user import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(
    db: AsyncSession = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    # Case-insensitive email lookup
    result = await db.execute(
        select(User).where(func.lower(User.email) == form_data.username.strip().lower())
    )
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is inactive"
        )
    
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)
    
    access_token = create_access_token(
        subject=str(user.id), expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(
        subject=str(user.id), expires_delta=refresh_token_expires
    )
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user
    }


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    *,
    db: AsyncSession = Depends(get_db),
    signup_data: SignupRequest
) -> Any:
    """
    Create new dealership and admin user account
    """
    # Check if email already exists
    result = await db.execute(select(User).where(User.email == signup_data.email))
    existing_user = result.scalar_one_or_none()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create the dealership first
    dealership = Dealership(
        name=signup_data.dealership_name,
        email=signup_data.email,
        is_active=True
    )
    db.add(dealership)
    await db.flush()  # Get the dealership ID
    
    # Create the admin user
    user = User(
        email=signup_data.email,
        password_hash=get_password_hash(signup_data.password),
        first_name=signup_data.first_name,
        last_name=signup_data.last_name,
        role=UserRole.DEALERSHIP_ADMIN,
        dealership_id=dealership.id,
        is_active=True
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    # Generate access and refresh tokens for immediate login
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)
    
    access_token = create_access_token(
        subject=str(user.id), expires_delta=access_token_expires
    )
    refresh_token = create_refresh_token(
        subject=str(user.id), expires_delta=refresh_token_expires
    )
    
    return {
        "message": "Account created successfully",
        "user": user,
        "dealership": dealership,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/refresh", response_model=Token)
async def refresh_access_token(
    refresh_data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Refresh access token using refresh token
    """
    # Verify refresh token
    user_id = verify_token(refresh_data.refresh_token, token_type="refresh")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Get user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is inactive"
        )
    
    # Generate new access token
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        subject=str(user.id), expires_delta=access_token_expires
    )
    
    # Optionally generate a new refresh token (rotate refresh tokens)
    refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)
    refresh_token = create_refresh_token(
        subject=str(user.id), expires_delta=refresh_token_expires
    )
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user
    }


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get current user information
    """
    return current_user


# ============== Password Reset Endpoints ==============

async def send_password_reset_email(user: User, reset_url: str):
    """Send password reset email (runs in background)"""
    try:
        from app.services.email_sender import SMTPProvider
        
        provider = SMTPProvider()
        if not provider.is_configured():
            logger.warning(f"SMTP not configured, cannot send password reset email to {user.email}")
            return
        
        subject = "Reset Your TikunCRM Password"
        body_html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>Hi {user.first_name},</p>
            <p>You requested to reset your password for TikunCRM. Click the button below to reset it:</p>
            <p style="text-align: center; margin: 30px 0;">
                <a href="{reset_url}" 
                   style="background-color: #2563eb; color: white; padding: 12px 24px; 
                          text-decoration: none; border-radius: 6px; display: inline-block;">
                    Reset Password
                </a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #6b7280;">{reset_url}</p>
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
                This link will expire in 24 hours.<br>
                If you didn't request this, you can safely ignore this email.
            </p>
        </body>
        </html>
        """
        body_text = f"""
        Hi {user.first_name},
        
        You requested to reset your password for TikunCRM.
        
        Click here to reset: {reset_url}
        
        This link will expire in 24 hours.
        If you didn't request this, you can safely ignore this email.
        """
        
        result = provider.send(
            to_email=user.email,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            from_email=settings.smtp_user or settings.email_from_address,
            from_name=settings.email_from_name or "TikunCRM"
        )
        
        if result.get("success"):
            logger.info(f"Password reset email sent to {user.email}")
        else:
            logger.error(f"Failed to send password reset email: {result.get('error')}")
            
    except Exception as e:
        logger.error(f"Error sending password reset email: {e}")


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    request: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Request a password reset email.
    Always returns success to prevent email enumeration.
    """
    # Find user by email (case insensitive)
    result = await db.execute(
        select(User).where(func.lower(User.email) == request.email.strip().lower())
    )
    user = result.scalar_one_or_none()
    
    if user and user.is_active:
        # Invalidate any existing tokens for this user
        await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used == False
            )
        )
        
        # Create new reset token
        token_model, raw_token = PasswordResetToken.create_for_user(user.id)
        db.add(token_model)
        await db.commit()
        
        # Build reset URL
        reset_url = f"{settings.frontend_url}/reset-password?token={raw_token}"
        
        # Send email in background
        background_tasks.add_task(send_password_reset_email, user, reset_url)
        
        logger.info(f"Password reset requested for user: {user.email}")
    else:
        # Log but don't reveal user doesn't exist
        logger.info(f"Password reset requested for non-existent email: {request.email}")
    
    # Always return success to prevent email enumeration
    return ForgotPasswordResponse(
        message="If an account with that email exists, we've sent a password reset link.",
        success=True
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    request: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Reset password using token from email.
    """
    # Hash the provided token
    token_hash = PasswordResetToken.hash_token(request.token)
    
    # Find the token
    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash
        )
    )
    token_model = result.scalar_one_or_none()
    
    if not token_model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset link. Please request a new one."
        )
    
    if not token_model.is_valid():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link has expired or already been used. Please request a new one."
        )
    
    # Get the user
    result = await db.execute(
        select(User).where(User.id == token_model.user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to reset password. Please contact support."
        )
    
    # Update password
    user.password_hash = get_password_hash(request.new_password)
    user.password_changed_at = utc_now()
    user.must_change_password = False
    
    # Mark token as used
    token_model.mark_used()
    
    await db.commit()
    
    logger.info(f"Password reset successful for user: {user.email}")
    
    return ResetPasswordResponse(
        message="Your password has been reset successfully. You can now log in.",
        success=True
    )


@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    request: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Change password for authenticated user.
    Used for voluntary password change or forced password change.
    """
    # Verify current password
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    # Check new password is different
    if verify_password(request.new_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password"
        )
    
    # Update password
    current_user.password_hash = get_password_hash(request.new_password)
    current_user.password_changed_at = utc_now()
    current_user.must_change_password = False
    
    await db.commit()
    
    logger.info(f"Password changed for user: {current_user.email}")
    
    return ChangePasswordResponse(
        message="Your password has been changed successfully.",
        success=True
    )
