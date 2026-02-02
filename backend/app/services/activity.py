"""
Activity Logging Service
"""
import json
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity, ActivityType


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
        ip_address: Optional[str] = None
    ) -> Activity:
        """
        Create a new activity log entry.
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
        await db.flush()
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
