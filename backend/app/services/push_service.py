"""
Push Notification Service - FCM Only
Uses Firebase Cloud Messaging (FCM) HTTP V1 API for all push notifications.
"""
import logging
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.fcm_token import FCMToken
from app.models.user import User

logger = logging.getLogger(__name__)


class PushService:
    """
    Service for sending push notifications via Firebase Cloud Messaging (FCM).
    
    Usage:
        push = PushService()
        await push.send_to_user(db, user_id, "Title", "Body", "/leads/123")
    """
    
    @property
    def is_configured(self) -> bool:
        """Check if FCM is configured"""
        return settings.is_fcm_configured
    
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
        Send push notification to all active FCM devices for a user.
        
        Args:
            db: Database session
            user_id: User ID to send to
            title: Notification title
            body: Notification body
            url: Optional URL to open on click
            icon: Optional icon URL (not used in FCM)
            tag: Optional notification tag
            data: Optional additional data
            
        Returns:
            Number of successful sends
        """
        if not self.is_configured:
            logger.debug("FCM not configured - skipping push notification")
            return 0

        success_count = 0

        try:
            from app.services.fcm_service import fcm_service, InvalidFCMTokenError
            
            # Get all active FCM tokens for this user
            fcm_result = await db.execute(
                select(FCMToken).where(
                    FCMToken.user_id == user_id,
                    FCMToken.is_active == True
                )
            )
            fcm_tokens = fcm_result.scalars().all()
            
            if not fcm_tokens:
                logger.debug(f"No active FCM tokens for user {user_id}")
                return 0
            
            # Send to each FCM token
            for fcm_token in fcm_tokens:
                try:
                    ok = await fcm_service.send(
                        token=fcm_token.token,
                        title=title,
                        body=body,
                        url=url,
                        tag=tag,
                        data=data,
                    )
                    if ok:
                        success_count += 1
                        fcm_token.mark_success()
                    else:
                        fcm_token.mark_failed()
                except InvalidFCMTokenError:
                    # Token is definitively invalid - delete it immediately
                    logger.info(f"Deleting invalid FCM token {fcm_token.id} for user {user_id}")
                    await db.delete(fcm_token)
                    
        except Exception as e:
            logger.exception(f"FCM send_to_user error: {e}")

        await db.commit()
        logger.info(f"Sent push to {success_count}/{len(fcm_tokens)} FCM device(s) for user {user_id}")
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
        Send push notification to multiple users via FCM.
        
        Returns:
            Dict with total_users, total_devices, and success_count
        """
        if not self.is_configured:
            return {"total_users": 0, "total_devices": 0, "success_count": 0}

        success_count = 0
        for uid in user_ids:
            success_count += await self.send_to_user(
                db=db,
                user_id=uid,
                title=title,
                body=body,
                url=url,
                icon=icon,
                tag=tag,
                data=data,
            )

        # Count total FCM devices for response
        total_devices = 0
        try:
            from app.services.fcm_service import fcm_service
            if fcm_service.is_configured:
                r = await db.execute(
                    select(FCMToken).where(
                        FCMToken.user_id.in_(user_ids),
                        FCMToken.is_active == True
                    )
                )
                total_devices = len(r.scalars().all())
        except Exception:
            pass

        return {
            "total_users": len(user_ids),
            "total_devices": total_devices,
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
        Send push notification to all users in a dealership via FCM.
        
        Args:
            db: Database session
            dealership_id: Dealership ID
            title: Notification title
            body: Notification body
            url: Optional URL to open
            exclude_user_id: Optional user ID to exclude
            
        Returns:
            Dict with total_users and success_count
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
        
        stats = await self.send_to_users(db, user_ids, title, body, url)
        return {
            "total_users": stats["total_users"],
            "success_count": stats["success_count"]
        }


# Singleton instance
push_service = PushService()
