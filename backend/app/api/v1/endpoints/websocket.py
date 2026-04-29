"""
WebSocket Endpoint for real-time updates
"""
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import jwt

from app.core.config import settings
from app.core.websocket_manager import ws_manager

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
    - lead:assigned - Lead was assigned
    - activity:new - New activity on a lead
    """
    logger.info(f"WebSocket connection attempt from {websocket.client}")
    
    # Verify token
    payload = verify_ws_token(token)
    if not payload:
        logger.warning(f"WebSocket rejected: invalid token from {websocket.client}")
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    user_id = payload.get("sub")
    dealership_id = payload.get("dealership_id")
    
    logger.info(f"WebSocket token verified: user={user_id}, dealership={dealership_id}")
    
    if not user_id:
        logger.warning("WebSocket rejected: no user_id in token")
        await websocket.close(code=4001, reason="Invalid token payload")
        return
    
    # Connect
    await ws_manager.connect(websocket, user_id, dealership_id)
    
    try:
        while True:
            # Keep connection alive by receiving messages (ping/pong handled automatically)
            # Client can also send messages if needed in the future
            data = await websocket.receive_text()
            
            # Handle ping from client
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: user={user_id}")
        ws_manager.disconnect(websocket, user_id, dealership_id)
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
        ws_manager.disconnect(websocket, user_id, dealership_id)
