"""
WebSocket Connection Manager for real-time updates
"""
import logging
from typing import Dict, List, Optional, Set
from uuid import UUID
import json

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Manages WebSocket connections for real-time updates.
    Supports:
    - Per-user connections (notifications, lead updates)
    - Broadcasting to multiple users
    - Dealership-wide broadcasts
    """
    
    def __init__(self):
        # user_id -> set of WebSocket connections (user might have multiple tabs)
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # dealership_id -> set of user_ids (for dealership broadcasts)
        self.dealership_users: Dict[str, Set[str]] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str, dealership_id: Optional[str] = None):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        
        # Add to user's connections
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        
        # Track dealership membership for broadcasts
        if dealership_id:
            if dealership_id not in self.dealership_users:
                self.dealership_users[dealership_id] = set()
            self.dealership_users[dealership_id].add(user_id)
        
        logger.info(f"WebSocket connected: user={user_id}, dealership={dealership_id}")
    
    def disconnect(self, websocket: WebSocket, user_id: str, dealership_id: Optional[str] = None):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            # Clean up if no more connections for this user
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                # Remove from dealership tracking
                if dealership_id and dealership_id in self.dealership_users:
                    self.dealership_users[dealership_id].discard(user_id)
                    if not self.dealership_users[dealership_id]:
                        del self.dealership_users[dealership_id]
        
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
            
            # Remove dead connections
            for ws in dead_connections:
                self.active_connections[user_id].discard(ws)
    
    async def send_to_users(self, user_ids: List[str], message: dict):
        """Send a message to multiple users"""
        for user_id in user_ids:
            await self.send_to_user(user_id, message)
    
    async def broadcast_to_dealership(self, dealership_id: str, message: dict, exclude_user: Optional[str] = None):
        """Broadcast a message to all users in a dealership"""
        if dealership_id in self.dealership_users:
            for user_id in self.dealership_users[dealership_id]:
                if user_id != exclude_user:
                    await self.send_to_user(user_id, message)
    
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
