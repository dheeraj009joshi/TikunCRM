"""
Push Notification Endpoints
"""
from typing import Any, Optional
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.db.database import get_db
from app.models.user import User
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)

router = APIRouter()


# ============== Schemas ==============

class PushSubscriptionKeys(BaseModel):
    """Push subscription keys from browser"""
    p256dh: str
    auth: str


class PushSubscriptionData(BaseModel):
    """Push subscription from browser"""
    endpoint: str
    keys: PushSubscriptionKeys
    expirationTime: Optional[int] = None


class SubscribeRequest(BaseModel):
    """Request to subscribe to push notifications"""
    subscription: PushSubscriptionData
    device_name: Optional[str] = None


class UnsubscribeRequest(BaseModel):
    """Request to unsubscribe from push notifications"""
    endpoint: str


class VapidPublicKeyResponse(BaseModel):
    """VAPID public key for client"""
    public_key: str


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
    
    class Config:
        from_attributes = True


# ============== Endpoints ==============

@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key() -> Any:
    """
    Get the VAPID public key for push subscription.
    This is needed by the frontend to subscribe to push notifications.
    """
    if not settings.vapid_public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications not configured"
        )
    
    return VapidPublicKeyResponse(public_key=settings.vapid_public_key)


@router.post("/subscribe", response_model=SubscriptionResponse)
async def subscribe_to_push(
    request: Request,
    subscribe_data: SubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Subscribe to push notifications.
    Creates or updates a push subscription for the current user.
    """
    subscription = subscribe_data.subscription
    
    # Check if subscription already exists (by endpoint)
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == subscription.endpoint
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing subscription
        existing.user_id = current_user.id
        existing.p256dh_key = subscription.keys.p256dh
        existing.auth_key = subscription.keys.auth
        existing.subscription_json = subscription.model_dump()
        existing.is_active = True
        existing.failed_count = 0
        
        if subscribe_data.device_name:
            existing.device_name = subscribe_data.device_name
        
        # Update user agent
        user_agent = request.headers.get("user-agent")
        if user_agent:
            existing.user_agent = user_agent[:500]
        
        await db.commit()
        
        logger.info(f"Updated push subscription for user {current_user.id}")
        
        return SubscriptionResponse(
            success=True,
            message="Push subscription updated",
            subscription_id=str(existing.id)
        )
    
    # Create new subscription
    user_agent = request.headers.get("user-agent", "")[:500]
    
    new_subscription = PushSubscription(
        user_id=current_user.id,
        endpoint=subscription.endpoint,
        p256dh_key=subscription.keys.p256dh,
        auth_key=subscription.keys.auth,
        subscription_json=subscription.model_dump(),
        user_agent=user_agent,
        device_name=subscribe_data.device_name,
        is_active=True
    )
    
    db.add(new_subscription)
    await db.commit()
    await db.refresh(new_subscription)
    
    logger.info(f"Created push subscription for user {current_user.id}")
    
    return SubscriptionResponse(
        success=True,
        message="Successfully subscribed to push notifications",
        subscription_id=str(new_subscription.id)
    )


@router.post("/unsubscribe", response_model=SubscriptionResponse)
async def unsubscribe_from_push(
    unsubscribe_data: UnsubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Unsubscribe from push notifications.
    Removes the push subscription for the specified endpoint.
    """
    # Find and delete the subscription
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == unsubscribe_data.endpoint,
            PushSubscription.user_id == current_user.id
        )
    )
    subscription = result.scalar_one_or_none()
    
    if subscription:
        await db.delete(subscription)
        await db.commit()
        logger.info(f"Deleted push subscription for user {current_user.id}")
    
    return SubscriptionResponse(
        success=True,
        message="Successfully unsubscribed from push notifications"
    )


@router.get("/subscriptions", response_model=list[SubscriptionListItem])
async def list_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    List all push subscriptions for the current user.
    Useful for managing devices.
    """
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == current_user.id
        ).order_by(PushSubscription.created_at.desc())
    )
    subscriptions = result.scalars().all()
    
    return [
        SubscriptionListItem(
            id=str(sub.id),
            device_name=sub.device_name,
            user_agent=sub.user_agent,
            is_active=sub.is_active,
            created_at=sub.created_at.isoformat(),
            last_success_at=sub.last_success_at.isoformat() if sub.last_success_at else None
        )
        for sub in subscriptions
    ]


@router.delete("/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def delete_subscription(
    subscription_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Delete a specific push subscription.
    """
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.id == subscription_id,
            PushSubscription.user_id == current_user.id
        )
    )
    subscription = result.scalar_one_or_none()
    
    if not subscription:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found"
        )
    
    await db.delete(subscription)
    await db.commit()
    
    return SubscriptionResponse(
        success=True,
        message="Subscription deleted"
    )


@router.post("/test", response_model=SubscriptionResponse)
async def send_test_notification(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Send a test push notification to the current user.
    Useful for verifying push notifications are working.
    """
    from app.services.push_service import push_service
    
    if not push_service.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications not configured"
        )
    
    # Count subscriptions
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == current_user.id,
            PushSubscription.is_active == True
        )
    )
    subscriptions = result.scalars().all()
    
    if not subscriptions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active push subscriptions found. Please enable push notifications first."
        )
    
    # Send test notification
    success_count = await push_service.send_to_user(
        db=db,
        user_id=current_user.id,
        title="Test Notification 🔔",
        body=f"Hello {current_user.first_name}! Push notifications are working correctly.",
        url="/notifications",
        tag="test-notification"
    )
    
    return SubscriptionResponse(
        success=success_count > 0,
        message=f"Test notification sent to {success_count}/{len(subscriptions)} devices"
    )
