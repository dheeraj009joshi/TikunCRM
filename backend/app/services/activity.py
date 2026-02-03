"""
Activity Logging Service
"""
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityType

logger = logging.getLogger(__name__)


class ActivityService:
    """Service for handling activity and audit logging"""
    
    @staticmethod
    async def log_activity(
        db: AsyncSession,
        *,
        activity_type: ActivityType,
        description: str,
        user_id: Optional[UUID] = None,
        lead_id: Optional[UUID] = None,
        dealership_id: Optional[UUID] = None,
        meta_data: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        update_lead_activity: bool = True
    ) -> Activity:
        """
        Create a new activity log entry.
        Also updates the lead's last_activity_at for auto-assignment tracking.
        """
        activity = Activity(
            type=activity_type,
            description=description,
            user_id=user_id,
            lead_id=lead_id,
            dealership_id=dealership_id,
            meta_data=meta_data or {},
            ip_address=ip_address
        )
        
        db.add(activity)
        
        # Update lead's last_activity_at for assignment tracking
        if lead_id and update_lead_activity:
            from app.models.lead import Lead
            result = await db.execute(
                select(Lead).where(Lead.id == lead_id)
            )
            lead = result.scalar_one_or_none()
            if lead:
                lead.last_activity_at = datetime.utcnow()
        
        await db.flush()
        
        # Emit WebSocket event for real-time updates
        if lead_id:
            try:
                from app.services.notification_service import emit_activity_added
                await emit_activity_added(
                    lead_id=str(lead_id),
                    dealership_id=str(dealership_id) if dealership_id else None,
                    activity_data={
                        "id": str(activity.id),
                        "type": activity_type.value,
                        "description": description,
                        "user_id": str(user_id) if user_id else None,
                        "meta_data": meta_data or {},
                        "created_at": activity.created_at.isoformat() if activity.created_at else datetime.utcnow().isoformat(),
                    }
                )
            except Exception as e:
                # Don't fail activity creation if WebSocket fails
                logger.warning(f"Failed to emit WebSocket activity event: {e}")
        
        return activity

    @staticmethod
    async def log_lead_status_change(
        db: AsyncSession,
        *,
        user_id: UUID,
        lead_id: UUID,
        dealership_id: UUID,
        old_status: str,
        new_status: str,
        performer_name: str,
        notes: Optional[str] = None
    ) -> Activity:
        """Helper for logging lead status changes"""
        description = f"Status changed from {old_status} to {new_status} by {performer_name}"
        if notes:
            description += f". Notes: {notes}"
            
        return await ActivityService.log_activity(
            db,
            activity_type=ActivityType.STATUS_CHANGED,
            description=description,
            user_id=user_id,
            lead_id=lead_id,
            dealership_id=dealership_id,
            meta_data={
                "old_status": old_status,
                "new_status": new_status,
                "performer_name": performer_name,
                "notes": notes
            }
        )

    @staticmethod
    async def log_lead_assignment(
        db: AsyncSession,
        *,
        user_id: UUID,  # Performer
        lead_id: UUID,
        dealership_id: UUID,
        assigned_to_id: UUID,
        assigned_to_name: str,  # Name of user being assigned
        performer_name: str,  # Name of user performing the action
        notes: Optional[str] = None
    ) -> Activity:
        """Helper for logging lead assignments"""
        description = f"Lead assigned to {assigned_to_name} by {performer_name}"
        
        return await ActivityService.log_activity(
            db,
            activity_type=ActivityType.LEAD_ASSIGNED,
            description=description,
            user_id=user_id,
            lead_id=lead_id,
            dealership_id=dealership_id,
            meta_data={
                "assigned_to": str(assigned_to_id),
                "assigned_to_name": assigned_to_name,
                "performer_name": performer_name,
                "notes": notes
            }
        )
