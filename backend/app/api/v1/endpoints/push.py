"""
Push Notification Endpoints - FCM Only
Firebase Cloud Messaging (FCM) token registration and testing.
"""
from typing import Any, List, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.db.database import get_db
from app.models.user import User
from app.models.fcm_token import FCMToken

logger = logging.getLogger(__name__)

router = APIRouter()


# ============== Schemas ==============

class FCMRegisterRequest(BaseModel):
    """Request to register an FCM device token"""
    token: str = Field(..., min_length=1, description="FCM registration token from Firebase SDK")
    device_name: Optional[str] = None


class FCMUnregisterRequest(BaseModel):
    """Request to unregister an FCM token"""
    token: str = Field(..., min_length=1)


class SubscriptionResponse(BaseModel):
    """Subscription response"""
    success: bool
    message: str
    subscription_id: Optional[str] = None


class SubscriptionListItem(BaseModel):
    """Subscription list item"""
    id: str
    device_name: Optional[str]
    user_agent: Optional[str]
    is_active: bool
    created_at: str
    last_success_at: Optional[str]
    provider: str = "fcm"

    class Config:
        from_attributes = True


# ============== FCM Endpoints ==============

@router.post("/fcm/register", response_model=SubscriptionResponse)
async def register_fcm_token(
    request: Request,
    body: FCMRegisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Register an FCM device token for the current user.
    Call this after getting the token from Firebase SDK (e.g. getToken()).
    
    Multi-browser support:
    - Each browser gets its own FCM token (Chrome token != Safari token)
    - We keep multiple active tokens per user (up to MAX_TOKENS_PER_USER)
    - Invalid tokens are cleaned up when FCM returns errors during send
    """
    MAX_TOKENS_PER_USER = 10  # Keep last 10 tokens per user
    
    if not settings.is_fcm_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FCM is not configured. Set FCM_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS.",
        )
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token is required")

    user_agent = (request.headers.get("user-agent") or "")[:500]
    
    # Log the token being registered for debugging
    logger.info("FCM token registration - user: %s, token (first 60): %s..., ua: %s", 
                current_user.id, token[:60], user_agent[:50])

    # Check if this exact token already exists
    result = await db.execute(select(FCMToken).where(FCMToken.token == token))
    existing = result.scalar_one_or_none()

    if existing:
        # Update existing token
        existing.user_id = current_user.id
        existing.device_name = body.device_name or existing.device_name
        existing.user_agent = user_agent
        existing.is_active = True
        existing.failed_count = 0
        await db.commit()
        logger.info("Updated existing FCM token for user %s", current_user.id)
        response_msg = "FCM token updated"
        subscription_id = str(existing.id)
    else:
        # Create new token
        new_token = FCMToken(
            user_id=current_user.id,
            token=token,
            device_name=body.device_name,
            user_agent=user_agent,
            is_active=True,
        )
        db.add(new_token)
        await db.commit()
        await db.refresh(new_token)
        logger.info("Registered new FCM token for user %s", current_user.id)
        response_msg = "FCM token registered successfully"
        subscription_id = str(new_token.id)
    
    # Clean up old tokens: keep only the last MAX_TOKENS_PER_USER tokens
    # This prevents unbounded growth while supporting multiple browsers
    
    # Get count of tokens for this user
    count_result = await db.execute(
        select(func.count(FCMToken.id)).where(FCMToken.user_id == current_user.id)
    )
    token_count = count_result.scalar() or 0
    
    if token_count > MAX_TOKENS_PER_USER:
        # Get IDs of tokens to keep (most recent ones)
        keep_query = (
            select(FCMToken.id)
            .where(FCMToken.user_id == current_user.id)
            .order_by(FCMToken.created_at.desc())
            .limit(MAX_TOKENS_PER_USER)
        )
        keep_result = await db.execute(keep_query)
        keep_ids = [row[0] for row in keep_result.fetchall()]
        
        # Delete old tokens
        if keep_ids:
            await db.execute(
                delete(FCMToken)
                .where(FCMToken.user_id == current_user.id)
                .where(FCMToken.id.not_in(keep_ids))
            )
            await db.commit()
            logger.info("Cleaned up old FCM tokens for user %s (kept %d)", current_user.id, MAX_TOKENS_PER_USER)
    
    return SubscriptionResponse(success=True, message=response_msg, subscription_id=subscription_id)


@router.post("/fcm/unregister", response_model=SubscriptionResponse)
async def unregister_fcm_token(
    body: FCMUnregisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Remove an FCM token for the current user."""
    result = await db.execute(
        select(FCMToken).where(
            FCMToken.token == body.token.strip(),
            FCMToken.user_id == current_user.id,
        )
    )
    token_row = result.scalar_one_or_none()
    if token_row:
        await db.delete(token_row)
        await db.commit()
        logger.info("Unregistered FCM token for user %s", current_user.id)
    return SubscriptionResponse(success=True, message="FCM token unregistered")


@router.get("/subscriptions", response_model=List[SubscriptionListItem])
async def list_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    List all FCM push subscriptions for the current user.
    """
    items: List[SubscriptionListItem] = []

    # Get FCM tokens
    fcm_result = await db.execute(
        select(FCMToken).where(FCMToken.user_id == current_user.id).order_by(FCMToken.created_at.desc())
    )
    for t in fcm_result.scalars().all():
        items.append(SubscriptionListItem(
            id=str(t.id),
            device_name=t.device_name,
            user_agent=t.user_agent,
            is_active=t.is_active,
            created_at=t.created_at.isoformat(),
            last_success_at=t.last_success_at.isoformat() if t.last_success_at else None,
            provider="fcm",
        ))

    return items


@router.delete("/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def delete_subscription(
    subscription_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Delete a specific FCM token subscription.
    """
    result = await db.execute(
        select(FCMToken).where(
            FCMToken.id == subscription_id,
            FCMToken.user_id == current_user.id
        )
    )
    fcm = result.scalar_one_or_none()
    if fcm:
        await db.delete(fcm)
        await db.commit()
        return SubscriptionResponse(success=True, message="FCM token deleted")

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Subscription not found"
    )


@router.post("/test", response_model=SubscriptionResponse)
async def send_test_notification(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Send a test push notification to the current user via FCM.
    """
    from app.services.push_service import push_service

    if not push_service.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications not configured. Please configure FCM in backend settings."
        )

    # Count FCM devices
    r = await db.execute(
        select(FCMToken).where(
            FCMToken.user_id == current_user.id,
            FCMToken.is_active == True,
        )
    )
    fcm_tokens = r.scalars().all()
    total_devices = len(fcm_tokens)

    if total_devices == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active push subscriptions found. Enable push notifications in Settings first.",
        )

    success_count = await push_service.send_to_user(
        db=db,
        user_id=current_user.id,
        title="Test Notification",
        body=f"Hello {current_user.first_name}! Push notifications are working.",
        url="/notifications",
        tag="test-notification"
    )

    return SubscriptionResponse(
        success=success_count > 0,
        message=f"Test notification sent to {success_count}/{total_devices} device(s)"
    )
