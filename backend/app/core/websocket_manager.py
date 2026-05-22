"""
WebSocket Connection Manager for real-time updates
"""
import logging
from typing import Dict, List, Optional, Set
import json

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Manages WebSocket connections for real-time updates.
    Supports:
    - Per-user connections (notifications, lead updates)
    - Broadcasting to multiple users
    - Dealership-wide broadcasts (including BDC agents on multiple stores)
    """
    
    def __init__(self):
        # user_id -> set of WebSocket connections (user might have multiple tabs)
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # dealership_id -> set of user_ids subscribed to that dealership's events
        self.dealership_users: Dict[str, Set[str]] = {}
        # user_id -> dealership ids this connection is registered under (for cleanup)
        self.user_broadcast_dealerships: Dict[str, Set[str]] = {}
    
    def _register_user_for_dealerships(
        self,
        user_id: str,
        dealership_ids: Set[str],
    ) -> None:
        """Subscribe user_id to dealership-wide broadcast channels."""
        self.user_broadcast_dealerships[user_id] = set(dealership_ids)
        for dealership_id in dealership_ids:
            if not dealership_id:
                continue
            if dealership_id not in self.dealership_users:
                self.dealership_users[dealership_id] = set()
            self.dealership_users[dealership_id].add(user_id)

    def _unregister_user_dealerships(self, user_id: str) -> None:
        for dealership_id in self.user_broadcast_dealerships.pop(user_id, set()):
            if dealership_id in self.dealership_users:
                self.dealership_users[dealership_id].discard(user_id)
                if not self.dealership_users[dealership_id]:
                    del self.dealership_users[dealership_id]

    async def connect(
        self,
        websocket: WebSocket,
        user_id: str,
        dealership_id: Optional[str] = None,
        accessible_dealership_ids: Optional[List[str]] = None,
    ):
        """Accept a new WebSocket connection and register broadcast subscriptions."""
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        
        dealers_to_register: Set[str] = set()
        if dealership_id:
            dealers_to_register.add(str(dealership_id))
        if accessible_dealership_ids:
            dealers_to_register.update(str(d) for d in accessible_dealership_ids if d)
        
        self._register_user_for_dealerships(user_id, dealers_to_register)
        
        if dealers_to_register:
            logger.info(
                "WebSocket connected: user=%s dealerships=%s",
                user_id,
                sorted(dealers_to_register),
            )
        else:
            logger.info(
                "WebSocket connected: user=%s (user-targeted events only; no dealership subscription)",
                user_id,
            )
    
    def disconnect(
        self,
        websocket: WebSocket,
        user_id: str,
        dealership_id: Optional[str] = None,
    ):
        """Remove a WebSocket connection and dealership subscriptions."""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                self._unregister_user_dealerships(user_id)
        
        logger.info(f"WebSocket disconnected: user={user_id}")
    
    async def send_to_user(self, user_id: str, message: dict):
        """Send a message to all connections of a specific user"""
        if user_id in self.active_connections:
            dead_connections = set()
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.warning(f"Failed to send to user {user_id}: {e}")
                    dead_connections.add(websocket)
            
            for ws in dead_connections:
                self.active_connections[user_id].discard(ws)
    
    async def send_to_users(self, user_ids: List[str], message: dict):
        """Send a message to multiple users"""
        for user_id in user_ids:
            await self.send_to_user(user_id, message)
    
    async def broadcast_to_dealership(
        self,
        dealership_id: str,
        message: dict,
        exclude_user: Optional[str] = None,
    ):
        """Broadcast a message to all users subscribed to a dealership (incl. BDC)."""
        if not dealership_id:
            logger.warning("broadcast_to_dealership called with empty dealership_id")
            return
        
        dealership_id = str(dealership_id)
        if dealership_id in self.dealership_users:
            user_count = len(self.dealership_users[dealership_id])
            logger.info(
                "Broadcasting %s to %s users in dealership %s",
                message.get("type"),
                user_count,
                dealership_id,
            )
            for user_id in self.dealership_users[dealership_id]:
                if user_id != exclude_user:
                    await self.send_to_user(user_id, message)
        else:
            logger.debug(
                "No users connected for dealership %s (event %s)",
                dealership_id,
                message.get("type"),
            )
    
    async def broadcast_all(self, message: dict):
        """Broadcast a message to all connected users"""
        for user_id in list(self.active_connections.keys()):
            await self.send_to_user(user_id, message)
    
    def get_connected_users(self) -> List[str]:
        """Get list of all connected user IDs"""
        return list(self.active_connections.keys())
    
    def is_user_connected(self, user_id: str) -> bool:
        """Check if a user has any active connections"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0


# Singleton instance
ws_manager = WebSocketManager()
