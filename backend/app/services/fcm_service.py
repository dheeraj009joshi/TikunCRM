"""
Firebase Cloud Messaging (FCM) HTTP V1 API Service
Sends push notifications via FCM using a service account.
"""
import json
import logging
import os
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class InvalidFCMTokenError(Exception):
    """Raised when an FCM token is invalid/expired and should be removed."""
    pass

# Scope required for FCM
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
FCM_V1_URL_TEMPLATE = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"


class FCMService:
    """
    Send push notifications via Firebase Cloud Messaging HTTP V1 API.
    Uses Google Application Default Credentials (service account JSON).
    """

    def __init__(self) -> None:
        self._credentials = None
        self._project_id: Optional[str] = None

    @property
    def is_configured(self) -> bool:
        return settings.is_fcm_configured

    def _get_credentials_path(self) -> Optional[str]:
        path = settings.fcm_service_account_path or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        if path and os.path.isfile(path):
            return path
        return None

    def _load_credentials(self) -> bool:
        if self._credentials is not None:
            return True
        path = self._get_credentials_path()
        if not path:
            return False
        try:
            from google.oauth2 import service_account
            self._credentials = service_account.Credentials.from_service_account_file(
                path,
                scopes=[FCM_SCOPE],
            )
            with open(path) as f:
                data = json.load(f)
            self._project_id = data.get("project_id") or settings.fcm_project_id
            return True
        except Exception as e:
            logger.exception("Failed to load FCM service account: %s", e)
            self._credentials = None
            self._project_id = None
            return False

    def _get_access_token(self) -> Optional[str]:
        if not self._load_credentials():
            return None
        try:
            from google.auth.transport.requests import Request
            self._credentials.refresh(Request())
            return self._credentials.token
        except Exception as e:
            logger.warning("FCM token refresh failed: %s", e)
            return None

    def _get_project_id(self) -> Optional[str]:
        if self._project_id:
            return self._project_id
        if settings.fcm_project_id:
            return settings.fcm_project_id
        self._load_credentials()
        return self._project_id

    async def send(
        self,
        token: str,
        title: str,
        body: str,
        url: Optional[str] = None,
        tag: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Send a push notification to a single FCM token via HTTP V1 API.

        Args:
            token: FCM registration token from the client
            title: Notification title
            body: Notification body
            url: Optional URL to open on click (web)
            tag: Optional tag for grouping
            data: Optional key-value data payload

        Returns:
            True if sent successfully, False otherwise
        """
        if not self.is_configured:
            logger.debug("FCM not configured - skipping")
            return False

        project_id = self._get_project_id()
        if not project_id:
            logger.error("FCM project_id not found")
            return False

        access_token = self._get_access_token()
        if not access_token:
            logger.error("FCM failed to get access token")
            return False

        # Full URL for icons
        base = (settings.frontend_url or "").rstrip("/")
        full_icon = f"{base}/icon.svg" if base else "/icon.svg"

        # FCM v1 message format for web push - DATA ONLY
        # We send data-only messages to force the Service Worker to handle display.
        # This is more reliable across browsers than automatic notification display.
        
        # All data values must be strings (FCM requirement)
        data_payload = {
            "title": title,
            "body": body,
            "icon": full_icon,
            "tag": tag or "tikuncrm",
            "url": url or "/notifications",
            **(data or {})
        }
        data_payload = {k: str(v) for k, v in data_payload.items()}

        message = {
            "message": {
                "token": token,
                "data": data_payload,
                "webpush": {
                    "headers": {
                        "Urgency": "high",
                        "TTL": "86400",
                    },
                },
            }
        }

        api_url = FCM_V1_URL_TEMPLATE.format(project_id=project_id)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        
        logger.info("FCM sending to token: %s...", token[:50])
        logger.info("FCM message: title=%s, body=%s", title, body[:50] if body else "")

        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    api_url,
                    json=message,
                    headers=headers,
                )
            if response.status_code == 200:
                logger.info("FCM notification sent successfully to token %s...", token[:20])
                return True
            # Log detailed error
            logger.warning(
                "FCM send failed: status=%s body=%s",
                response.status_code,
                response.text[:500],
            )
            # Return status code for caller to handle token cleanup
            # 404 = UNREGISTERED token (user unsubscribed, app uninstalled, token expired)
            # 400 = INVALID_ARGUMENT (malformed token)
            if response.status_code in (404, 400):
                logger.info("FCM token %s... is invalid/unregistered (%d) - should be removed", token[:20], response.status_code)
                # Raise a specific exception so caller can deactivate immediately
                raise InvalidFCMTokenError(f"Token is invalid: {response.status_code}")
            return False
        except InvalidFCMTokenError:
            raise  # Re-raise to be handled by caller
        except Exception as e:
            logger.exception("FCM send error: %s", e)
            return False


fcm_service = FCMService()
