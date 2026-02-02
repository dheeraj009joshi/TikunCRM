"""
Google OAuth Service
"""
from datetime import datetime, timedelta
import json
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow

from app.core.config import settings
from app.models.oauth_token import OAuthToken, OAuthProvider


class GoogleAuthService:
    """Service for handling Google OAuth flows and token management"""

    SCOPES = [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid"
    ]

    @staticmethod
    def get_flow() -> Flow:
        """Initialize the OAuth flow"""
        return Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=GoogleAuthService.SCOPES,
            redirect_uri=settings.google_redirect_uri
        )

    @staticmethod
    async def save_tokens(
        db: AsyncSession,
        user_id: UUID,
        credentials: Credentials
    ) -> OAuthToken:
        """Save or update Google OAuth tokens in database"""
        query = select(OAuthToken).where(
            OAuthToken.user_id == user_id,
            OAuthToken.provider == OAuthProvider.GOOGLE
        )
        result = await db.execute(query)
        token_record = result.scalar_one_or_none()

        if token_record:
            token_record.access_token = credentials.token
            if credentials.refresh_token:
                token_record.refresh_token = credentials.refresh_token
            token_record.expires_at = credentials.expiry
            token_record.scope = " ".join(credentials.scopes)
        else:
            token_record = OAuthToken(
                user_id=user_id,
                provider=OAuthProvider.GOOGLE,
                access_token=credentials.token,
                refresh_token=credentials.refresh_token,
                expires_at=credentials.expiry,
                scope=" ".join(credentials.scopes)
            )
            db.add(token_record)

        await db.flush()
        return token_record

    @staticmethod
    async def get_credentials(
        db: AsyncSession,
        user_id: UUID
    ) -> Optional[Credentials]:
        """Get valid Google credentials for a user, refreshing if necessary"""
        query = select(OAuthToken).where(
            OAuthToken.user_id == user_id,
            OAuthToken.provider == OAuthProvider.GOOGLE
        )
        result = await db.execute(query)
        token_record = result.scalar_one_or_none()

        if not token_record:
            return None

        creds = Credentials(
            token=token_record.access_token,
            refresh_token=token_record.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            scopes=token_record.scope.split(" ") if token_record.scope else GoogleAuthService.SCOPES
        )

        if token_record.is_expired and token_record.refresh_token:
            creds.refresh(Request())
            # Update database with new access token
            token_record.access_token = creds.token
            token_record.expires_at = creds.expiry
            await db.flush()

        return creds
