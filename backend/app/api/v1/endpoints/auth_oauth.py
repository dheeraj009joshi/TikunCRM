"""
OAuth 2.0 Auth Endpoints
"""
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from app.api import deps
from app.db.database import get_db
from app.services.google_auth import GoogleAuthService
from app.models.user import User

router = APIRouter()


@router.get("/google/authorize")
async def google_authorize(
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Generate Google Authorization URL and redirect.
    In a real app, we'd pass the user ID in the state.
    """
    flow = GoogleAuthService.get_flow()
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent"
    )
    # We should store 'state' in session/cache to verify callback
    return {"url": authorization_url}


@router.get("/google/callback")
async def google_callback(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    OAuth2 callback from Google.
    Exchanges code for tokens and saves them.
    """
    # Note: In a real implementation, we'd fetch the current user from session or state
    # For this MVP, we assume a hardcoded user or first admin for demonstration if not provided
    # Production would use the 'state' parameter to map back to the initiating user.
    
    flow = GoogleAuthService.get_flow()
    flow.fetch_token(authorization_response=str(request.url))
    credentials = flow.credentials
    
    # Example: Map to a specific user (In production this is dynamic)
    from app.models.user import User, UserRole
    result = await db.execute(select(User).where(User.role == UserRole.SUPER_ADMIN))
    user = result.scalars().first()
    
    if user:
        await GoogleAuthService.save_tokens(db, user.id, credentials)
        return {"status": "success", "message": f"Connected Google account for {user.email}"}
    
    return {"status": "error", "message": "No user found to link token"}

from sqlalchemy import select
