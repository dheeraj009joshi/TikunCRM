"""
WebSocket Endpoint for real-time updates
"""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import jwt

from app.core.config import settings
from app.core.websocket_manager import ws_manager
from app.core.access_scope import build_ws_token_claims, get_accessible_dealership_ids
from app.core.permissions import UserRole
from app.db.database import async_session_maker
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()


def verify_ws_token(token: str) -> Optional[dict]:
    """Verify JWT token for WebSocket connection"""
    try:
        payload = jwt.decode(
            token, 
            settings.secret_key, 
            algorithms=[settings.algorithm]
        )
        return payload
    except jwt.PyJWTError as e:
        logger.warning(f"WebSocket token verification failed: {e}")
        return None


def _dealership_ids_from_token(payload: dict) -> List[str]:
    """Extract dealership broadcast subscriptions from JWT claims."""
    ids: List[str] = []
    primary = payload.get("dealership_id")
    if primary:
        ids.append(str(primary))
    extra = payload.get("accessible_dealership_ids")
    if isinstance(extra, list):
        ids.extend(str(d) for d in extra if d)
    return list(dict.fromkeys(ids))  # preserve order, dedupe


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """
    WebSocket endpoint for real-time updates.
    
    Connect with: ws://host/api/v1/ws?token=<jwt_token>
    
    Events received:
    - notification:new - New notification created
    - lead:updated - Lead was updated
    - lead:created - New lead in an assigned dealership
    - activity:new - New activity on a lead
    - badges:refresh / stats:refresh - Sidebar and dashboard updates
    """
    logger.info(f"WebSocket connection attempt from {websocket.client}")
    
    payload = verify_ws_token(token)
    if not payload:
        logger.warning(f"WebSocket rejected: invalid token from {websocket.client}")
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    user_id = payload.get("sub")
    dealership_id = payload.get("dealership_id")
    accessible_dealership_ids = _dealership_ids_from_token(payload)
    
    if not user_id:
        logger.warning("WebSocket rejected: no user_id in token")
        await websocket.close(code=4001, reason="Invalid token payload")
        return
    
    # Refresh BDC / org-wide subscriptions from DB so new dealership assignments apply without re-login
    try:
        async with async_session_maker() as db:
            user = await db.get(User, UUID(str(user_id)))
            if user and user.is_active:
                if user.role == UserRole.BDC:
                    ids = await get_accessible_dealership_ids(db, user)
                    accessible_dealership_ids = [str(i) for i in (ids or [])]
                elif user.dealership_id:
                    accessible_dealership_ids = [str(user.dealership_id)]
                    dealership_id = str(user.dealership_id)
                else:
                    # Prefer fresh claims for tokens that already include accessible_dealership_ids
                    claims = await build_ws_token_claims(db, user)
                    accessible_dealership_ids = _dealership_ids_from_token(claims)
                    dealership_id = claims.get("dealership_id") or dealership_id
    except Exception as e:
        logger.warning("WebSocket: could not refresh dealership subscriptions for user %s: %s", user_id, e)
    
    logger.info(
        "WebSocket token verified: user=%s role=%s dealerships=%s",
        user_id,
        payload.get("role"),
        accessible_dealership_ids,
    )
    
    await ws_manager.connect(
        websocket,
        user_id,
        str(dealership_id) if dealership_id else None,
        accessible_dealership_ids=accessible_dealership_ids or None,
    )
    
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: user={user_id}")
        ws_manager.disconnect(websocket, user_id, dealership_id)
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
        ws_manager.disconnect(websocket, user_id, dealership_id)
