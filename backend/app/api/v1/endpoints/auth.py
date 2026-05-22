"""
Authentication Endpoints - Enhanced with Signup and Password Reset
"""
from datetime import datetime, timedelta
from typing import Any, List, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, Form, HTTPException, status, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    create_config_unlock_token,
    verify_password,
    get_password_hash,
    verify_token,
)
from app.core.timezone import utc_now
from app.core.access_scope import build_ws_token_claims
from app.db.database import get_db
from app.models.user import User, UserRole
from app.models.dealership import Dealership
from app.models.password_reset import PasswordResetToken
from app.schemas.auth import (
    Token, SignupRequest, SignupResponse, RefreshTokenRequest,
    ForgotPasswordRequest, ForgotPasswordResponse,
    ResetPasswordRequest, ResetPasswordResponse,
    ChangePasswordRequest, ChangePasswordResponse,
    ConfigAccessStatusResponse,
    ConfigAccessVerifyRequest,
    ConfigAccessUnlockResponse,
    DealershipLookupRequest,
    DealershipLookupResponse,
    DealershipLookupOption,
    DealershipRequiredDetail,
    SwitchDealershipRequest,
)
from app.schemas.user import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter()

_CONFIG_ACCESS_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.DEALERSHIP_OWNER,
    UserRole.DEALERSHIP_ADMIN,
)


async def _load_users_by_email(db: AsyncSession, email: str) -> List[User]:
    """Return all User rows matching the given email (case-insensitive)."""
    result = await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )
    return list(result.scalars().all())


def _build_dealership_options(
    users: List[User],
    dealership_name_by_id: dict,
) -> List[DealershipLookupOption]:
    """Render User rows as the public dealership-picker payload."""
    options: List[DealershipLookupOption] = []
    for u in users:
        if u.dealership_id is None:
            if u.role == UserRole.BDC:
                options.append(DealershipLookupOption(
                    id=None,
                    name="BDC Agent",
                    is_super_admin=False,
                    is_bdc=True,
                ))
            elif u.role == UserRole.SUPER_ADMIN:
                options.append(DealershipLookupOption(
                    id=None,
                    name="Super Admin",
                    is_super_admin=True,
                    is_bdc=False,
                ))
            else:
                options.append(DealershipLookupOption(
                    id=None,
                    name="Organization",
                    is_super_admin=False,
                    is_bdc=False,
                ))
        else:
            options.append(DealershipLookupOption(
                id=u.dealership_id,
                name=dealership_name_by_id.get(u.dealership_id, "Dealership"),
                is_super_admin=False,
                is_bdc=False,
            ))
    return options


def _filter_users_by_account_kind(
    users: List[User],
    *,
    dealership_id: Optional[UUID] = None,
    account_kind: Optional[str] = None,
) -> List[User]:
    """Narrow user rows for login, switch, or password reset."""
    kind = (account_kind or "").strip().lower()
    if kind == "bdc":
        return [u for u in users if u.role == UserRole.BDC]
    if kind == "super_admin":
        return [u for u in users if u.role == UserRole.SUPER_ADMIN]
    if dealership_id is not None:
        return [u for u in users if u.dealership_id == dealership_id]
    return [u for u in users if u.dealership_id is None]


async def _resolve_dealership_options(
    db: AsyncSession, users: List[User]
) -> List[DealershipLookupOption]:
    """Look up dealership names for the given users and return picker options."""
    dealership_ids = [u.dealership_id for u in users if u.dealership_id is not None]
    name_by_id: dict = {}
    if dealership_ids:
        rows = await db.execute(
            select(Dealership.id, Dealership.name).where(Dealership.id.in_(dealership_ids))
        )
        name_by_id = {row.id: row.name for row in rows}
    return _build_dealership_options(users, name_by_id)


@router.post("/lookup-dealerships", response_model=DealershipLookupResponse)
async def lookup_dealerships(
    body: DealershipLookupRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Return the list of dealerships an email is registered against.

    Used by the two-step login UI to decide whether to show a dealership picker
    before asking for the password. Always returns 200 with a (possibly empty)
    list — the frontend treats an empty list as "no account".
    """
    users = await _load_users_by_email(db, body.email)
    # Only surface active accounts; deactivated users should not be selectable.
    users = [u for u in users if u.is_active]
    options = await _resolve_dealership_options(db, users)
    return DealershipLookupResponse(dealerships=options)


@router.post("/login", response_model=Token)
async def login(
    db: AsyncSession = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    dealership_id: Optional[str] = Form(
        None,
        description=(
            "Optional dealership UUID. Required when the email is registered "
            "with multiple dealerships. Send 'super_admin' or 'bdc' for "
            "org-wide accounts (no dealership)."
        ),
    ),
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests.

    When the same email exists in multiple dealerships, the caller must pass
    `dealership_id` to disambiguate. If omitted in that case, the API responds
    with HTTP 409 and a list of dealerships so the frontend can show a picker.
    """
    users = await _load_users_by_email(db, form_data.username)

    if not users:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Resolve dealership_id form field (UUID, super_admin, or bdc)
    requested_dealership_uuid: Optional[UUID] = None
    account_kind: Optional[str] = None
    if dealership_id is not None and dealership_id.strip() != "":
        raw = dealership_id.strip().lower()
        if raw in ("super_admin", "bdc"):
            account_kind = raw
        else:
            try:
                requested_dealership_uuid = UUID(dealership_id.strip())
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid dealership_id",
                )

    if account_kind is not None:
        candidates = _filter_users_by_account_kind(users, account_kind=account_kind)
    elif requested_dealership_uuid is not None:
        candidates = _filter_users_by_account_kind(
            users, dealership_id=requested_dealership_uuid
        )
    else:
        candidates = users

    # Multiple candidates and no dealership chosen → ask the client to pick one
    if len(candidates) > 1:
        active_users = [u for u in candidates if u.is_active]
        options = await _resolve_dealership_options(db, active_users or candidates)
        detail = DealershipRequiredDetail(
            message="This email is registered with multiple dealerships. Select one to continue.",
            dealerships=options,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail.model_dump(mode="json"),
        )

    user = candidates[0] if candidates else None

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="account_deactivated",
        )

    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)

    additional_claims = await build_ws_token_claims(db, user)

    access_token = create_access_token(
        subject=str(user.id),
        expires_delta=access_token_expires,
        additional_claims=additional_claims if additional_claims else None,
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
    # Signup always provisions a brand-new dealership, so the only collision the
    # partial unique indexes can hit is an existing super admin (dealership_id IS NULL)
    # using the same email. Other dealership users sharing this email are allowed.
    result = await db.execute(
        select(User).where(
            func.lower(User.email) == signup_data.email.strip().lower(),
            User.dealership_id.is_(None),
        )
    )
    existing_super_admin = result.scalar_one_or_none()

    if existing_super_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email is already used by a super admin account"
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
    
    additional_claims = await build_ws_token_claims(db, user)
    if not additional_claims.get("dealership_id"):
        additional_claims["dealership_id"] = str(dealership.id)
    
    access_token = create_access_token(
        subject=str(user.id),
        expires_delta=access_token_expires,
        additional_claims=additional_claims,
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="account_deactivated",
        )
    
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    additional_claims = await build_ws_token_claims(db, user)

    access_token = create_access_token(
        subject=str(user.id),
        expires_delta=access_token_expires,
        additional_claims=additional_claims if additional_claims else None,
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


async def _issue_tokens_for_user(db: AsyncSession, user: User) -> dict:
    """Build access/refresh tokens and response payload for a user."""
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    refresh_token_expires = timedelta(days=settings.refresh_token_expire_days)

    additional_claims = await build_ws_token_claims(db, user)

    access_token = create_access_token(
        subject=str(user.id),
        expires_delta=access_token_expires,
        additional_claims=additional_claims if additional_claims else None,
    )
    refresh_token = create_refresh_token(
        subject=str(user.id), expires_delta=refresh_token_expires
    )

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user,
    }


def _resolve_target_user_for_dealership(
    users: List[User],
    dealership_id: Optional[UUID],
    account_kind: Optional[str] = None,
) -> Optional[User]:
    """Pick the active user row for the requested dealership or org-wide role."""
    if dealership_id is not None:
        candidates = _filter_users_by_account_kind(users, dealership_id=dealership_id)
    elif account_kind:
        candidates = _filter_users_by_account_kind(users, account_kind=account_kind)
    else:
        # Legacy: null dealership_id without account_kind → super admin only
        candidates = _filter_users_by_account_kind(users, account_kind="super_admin")
    active = [u for u in candidates if u.is_active]
    return (active or candidates)[0] if candidates else None


@router.get("/my-dealerships", response_model=DealershipLookupResponse)
async def my_dealerships(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    List every dealership the current user's email is registered with.
    Used by the in-app dealership switcher.
    """
    users = await _load_users_by_email(db, current_user.email)
    users = [u for u in users if u.is_active]
    options = await _resolve_dealership_options(db, users)
    return DealershipLookupResponse(dealerships=options)


@router.post("/switch-dealership", response_model=Token)
async def switch_dealership(
    body: SwitchDealershipRequest,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Switch to another dealership account that shares the same email.

    Issues new tokens for the target user row without requiring re-login.
    """
    users = await _load_users_by_email(db, current_user.email)
    if not users:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No accounts found for this email",
        )

    target = _resolve_target_user_for_dealership(
        users, body.dealership_id, body.account_kind
    )
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for the selected dealership",
        )

    if target.id == current_user.id:
        return await _issue_tokens_for_user(db, current_user)

    if not target.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="account_deactivated",
        )

    return await _issue_tokens_for_user(db, target)


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

    When the email is registered with multiple dealerships, the caller must
    pass `dealership_id` to disambiguate. If omitted in that case, responds
    409 dealership_required with the dealership list (mirrors /auth/login).
    Otherwise always returns success to prevent email enumeration.
    """
    users = await _load_users_by_email(db, request.email)
    active_users = [u for u in users if u.is_active]

    if request.dealership_id is not None:
        candidates = _filter_users_by_account_kind(
            active_users, dealership_id=request.dealership_id
        )
    elif request.account_kind:
        candidates = _filter_users_by_account_kind(
            active_users, account_kind=request.account_kind
        )
    else:
        candidates = active_users

    # Multiple matches without disambiguation → ask client to pick one
    if request.dealership_id is None and not request.account_kind and len(candidates) > 1:
        options = await _resolve_dealership_options(db, candidates)
        detail = DealershipRequiredDetail(
            message="This email is registered with multiple dealerships. Select one to continue.",
            dealerships=options,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail.model_dump(mode="json"),
        )

    user = candidates[0] if candidates else None

    if user:
        # Invalidate any prior unused reset tokens for this user
        await db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used == False,  # noqa: E712
            )
            .values(used=True)
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


@router.get("/config-access-status", response_model=ConfigAccessStatusResponse)
async def config_access_status(
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Whether this user must set a separate configuration-access password to use Twilio / dealership email secret APIs.
    """
    eligible = current_user.role in _CONFIG_ACCESS_ROLES
    return ConfigAccessStatusResponse(
        eligible=eligible,
        config_access_password_set=bool(current_user.config_access_password_hash),
    )


@router.post("/verify-config-access", response_model=ConfigAccessUnlockResponse)
async def verify_config_access(
    body: ConfigAccessVerifyRequest,
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Verify the configuration-access password and return a short-lived JWT for the X-Config-Unlock-Token header.
    """
    if current_user.role not in _CONFIG_ACCESS_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Configuration unlock is not available for this account",
        )
    if not current_user.config_access_password_hash:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="config_access_password_not_set",
        )
    if not verify_password(body.config_password, current_user.config_access_password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_config_access_password",
        )
    unlock_token = create_config_unlock_token(str(current_user.id))
    return ConfigAccessUnlockResponse(
        unlock_token=unlock_token,
        expires_in=settings.config_unlock_token_expire_minutes * 60,
    )
