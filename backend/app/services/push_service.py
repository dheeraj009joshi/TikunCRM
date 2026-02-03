"""
Web Push Notification Service
Uses pywebpush to send push notifications to subscribed browsers/devices.
"""
import json
import logging
import base64
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.push_subscription import PushSubscription
from app.models.user import User

logger = logging.getLogger(__name__)


def _decode_base64(data: str) -> bytes:
    """Decode URL-safe base64 with padding"""
    # Add padding if needed
    padding = 4 - (len(data) % 4)
    if padding != 4:
        data += '=' * padding
    return base64.urlsafe_b64decode(data)


class PushService:
    """
    Service for sending web push notifications.
    
    Usage:
        push = PushService()
        await push.send_to_user(db, user_id, "Title", "Body", "/leads/123")
    """
    
    def __init__(self):
        self._vapid_claims = None
        self._vapid = None
    
    @property
    def is_configured(self) -> bool:
        """Check if push is properly configured"""
        return settings.is_push_configured
    
    def _get_vapid_claims(self) -> dict:
        """Get VAPID claims for signing"""
        if self._vapid_claims is None:
            self._vapid_claims = {
                "sub": settings.vapid_claims_email
            }
        return self._vapid_claims
    
    def _get_private_key_pem(self):
        """Get the EC private key in PEM format for VAPID signing"""
        if self._vapid is None and self.is_configured:
            try:
                from cryptography.hazmat.primitives.asymmetric import ec
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.backends import default_backend
                
                # Decode the private key from base64
                private_key_bytes = _decode_base64(settings.vapid_private_key)
                
                # Create EC private key from raw bytes
                private_key = ec.derive_private_key(
                    int.from_bytes(private_key_bytes, 'big'),
                    ec.SECP256R1(),
                    default_backend()
                )
                
                # Serialize to PEM format (pywebpush expects PEM string)
                self._vapid = private_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption()
                ).decode('utf-8')
                
            except Exception as e:
                logger.error(f"Failed to initialize VAPID private key: {e}")
                self._vapid = None
        
        return self._vapid
    
    async def send_push(
        self,
        subscription: PushSubscription,
        title: str,
        body: str,
        url: Optional[str] = None,
        icon: Optional[str] = None,
        tag: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        db: Optional[AsyncSession] = None
    ) -> bool:
        """
        Send a push notification to a specific subscription.
        
        Args:
            subscription: The push subscription to send to
            title: Notification title
            body: Notification body text
            url: URL to open when notification is clicked
            icon: Custom icon URL
            tag: Notification tag for grouping
            data: Additional data to include
            db: Database session for updating subscription status
            
        Returns:
            True if successful, False otherwise
        """
        if not self.is_configured:
            logger.debug("Push not configured - skipping")
            return False
        
        try:
            from pywebpush import webpush, WebPushException
            
            # Build notification payload
            payload = {
                "title": title,
                "body": body,
                "icon": icon or "/icon.svg",
                "badge": "/icon.svg",
                "url": url or "/notifications",
                "tag": tag or "leadscrm-notification",
                "data": data or {},
                "timestamp": int(__import__("time").time() * 1000)
            }
            
            # Get subscription info
            subscription_info = subscription.get_subscription_info()
            
            # Send the push notification with raw base64 private key
            logger.info(f"Sending push notification to subscription {subscription.id}")
            logger.info(f"Payload: {payload}")
            
            webpush(
                subscription_info=subscription_info,
                data=json.dumps(payload),
                vapid_private_key=settings.vapid_private_key,
                vapid_claims=self._get_vapid_claims()
            )
            
            # Mark success if we have a session
            if db:
                subscription.mark_success()
            
            logger.info(f"Push notification sent successfully to subscription {subscription.id}")
            return True
            
        except ImportError:
            logger.error("pywebpush not installed. Run: pip install pywebpush")
            return False
        except Exception as e:
            error_str = str(e)
            logger.error(f"Push failed for subscription {subscription.id}: {error_str}")
            
            # Mark failure if we have a session
            if db:
                subscription.mark_failed()
                
                # Check if subscription should be removed (expired/unsubscribed)
                if "410" in error_str or "404" in error_str:
                    logger.info(f"Removing expired subscription {subscription.id}")
                    await db.delete(subscription)
            
            return False
    
    async def send_to_user(
        self,
        db: AsyncSession,
        user_id: UUID,
        title: str,
        body: str,
        url: Optional[str] = None,
        icon: Optional[str] = None,
        tag: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Send push notification to all active subscriptions for a user.
        
        Args:
            db: Database session
            user_id: User to notify
            title: Notification title
            body: Notification body
            url: URL to open on click
            icon: Custom icon
            tag: Notification tag
            data: Additional data
            
        Returns:
            Number of successful sends
        """
        if not self.is_configured:
            return 0
        
        # Get all active subscriptions for user
        result = await db.execute(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.is_active == True
            )
        )
        subscriptions = result.scalars().all()
        
        if not subscriptions:
            logger.debug(f"No push subscriptions for user {user_id}")
            return 0
        
        # Send to all subscriptions
        success_count = 0
        for subscription in subscriptions:
            if await self.send_push(
                subscription=subscription,
                title=title,
                body=body,
                url=url,
                icon=icon,
                tag=tag,
                data=data,
                db=db
            ):
                success_count += 1
        
        # Commit any subscription updates
        await db.commit()
        
        logger.info(f"Sent push to {success_count}/{len(subscriptions)} subscriptions for user {user_id}")
        return success_count
    
    async def send_to_users(
        self,
        db: AsyncSession,
        user_ids: List[UUID],
        title: str,
        body: str,
        url: Optional[str] = None,
        icon: Optional[str] = None,
        tag: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, int]:
        """
        Send push notification to multiple users.
        
        Returns:
            Dict with total_users, total_subscriptions, success_count
        """
        if not self.is_configured:
            return {"total_users": 0, "total_subscriptions": 0, "success_count": 0}
        
        # Get all active subscriptions for all users
        result = await db.execute(
            select(PushSubscription).where(
                PushSubscription.user_id.in_(user_ids),
                PushSubscription.is_active == True
            )
        )
        subscriptions = result.scalars().all()
        
        if not subscriptions:
            return {"total_users": len(user_ids), "total_subscriptions": 0, "success_count": 0}
        
        # Send to all subscriptions
        success_count = 0
        for subscription in subscriptions:
            if await self.send_push(
                subscription=subscription,
                title=title,
                body=body,
                url=url,
                icon=icon,
                tag=tag,
                data=data,
                db=db
            ):
                success_count += 1
        
        await db.commit()
        
        return {
            "total_users": len(user_ids),
            "total_subscriptions": len(subscriptions),
            "success_count": success_count
        }
    
    async def send_to_dealership(
        self,
        db: AsyncSession,
        dealership_id: UUID,
        title: str,
        body: str,
        url: Optional[str] = None,
        exclude_user_id: Optional[UUID] = None
    ) -> Dict[str, int]:
        """
        Send push notification to all users in a dealership.
        """
        if not self.is_configured:
            return {"total_users": 0, "success_count": 0}
        
        # Get all users in dealership
        query = select(User.id).where(
            User.dealership_id == dealership_id,
            User.is_active == True
        )
        if exclude_user_id:
            query = query.where(User.id != exclude_user_id)
        
        result = await db.execute(query)
        user_ids = [row[0] for row in result.fetchall()]
        
        if not user_ids:
            return {"total_users": 0, "success_count": 0}
        
        return await self.send_to_users(db, user_ids, title, body, url)


# Singleton instance
push_service = PushService()
