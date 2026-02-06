"""
Lead Assignment Background Tasks

Handles:
1. Auto-assignment: When a user adds a note to an unassigned lead, assign it to them
2. Stale unassignment: Unassign leads with no activity for 72 hours
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.core.websocket_manager import ws_manager
from app.models.lead import Lead, LeadStatus
from app.models.activity import Activity, ActivityType
from app.models.user import User
from app.models.notification import Notification, NotificationType
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

# Configuration
STALE_HOURS = 72  # Hours of inactivity before unassigning


def get_assignment_session_maker():
    """Create a dedicated engine and session maker for assignment operations."""
    from sqlalchemy.pool import NullPool
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        poolclass=NullPool,  # Use NullPool for background tasks
    )
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def auto_assign_leads_from_activity():
    """
    Check for unassigned leads that have ANY user activity and auto-assign them.
    
    Logic:
    - Find leads with no salesperson assigned (assigned_to is NULL)
    - That have at least one user-initiated activity (note, call, email, etc.)
    - Assign to the user who performed the FIRST activity
    - Also assign to that user's dealership if lead is in global pool
    
    This runs every minute as a fallback for inline auto-assignment.
    Handles both:
    - Leads in global pool (no dealership)
    - Leads in a dealership but no salesperson assigned
    """
    logger.debug("Running auto-assign check...")
    
    session_maker = get_assignment_session_maker()
    
    # Activity types that trigger auto-assignment (user-initiated actions)
    assignable_activity_types = [
        ActivityType.NOTE_ADDED,
        ActivityType.CALL_LOGGED,
        ActivityType.EMAIL_SENT,
        ActivityType.STATUS_CHANGED,
        ActivityType.FOLLOW_UP_SCHEDULED,
        ActivityType.APPOINTMENT_SCHEDULED,
    ]
    
    async with session_maker() as session:
        try:
            # Find leads with user activities
            leads_with_activity_subquery = (
                select(Activity.lead_id)
                .where(
                    Activity.type.in_(assignable_activity_types),
                    Activity.user_id.isnot(None)
                )
                .distinct()
            )
            
            # Get leads with no salesperson assigned (including leads in dealerships)
            result = await session.execute(
                select(Lead)
                .where(
                    Lead.assigned_to.is_(None),  # No salesperson assigned
                    Lead.id.in_(leads_with_activity_subquery)
                )
            )
            unassigned_leads = result.scalars().all()
            
            if not unassigned_leads:
                logger.debug("No unassigned leads with activities found")
                return
            
            assigned_count = 0
            
            for lead in unassigned_leads:
                # Get the first user activity for this lead
                first_activity_result = await session.execute(
                    select(Activity)
                    .where(
                        Activity.lead_id == lead.id,
                        Activity.type.in_(assignable_activity_types),
                        Activity.user_id.isnot(None)
                    )
                    .order_by(Activity.created_at.asc())
                    .limit(1)
                )
                first_activity = first_activity_result.scalar_one_or_none()
                
                if first_activity and first_activity.user_id:
                    # Get the user to get their dealership
                    user_result = await session.execute(
                        select(User).where(User.id == first_activity.user_id)
                    )
                    activity_user = user_result.scalar_one_or_none()
                    
                    if not activity_user or not activity_user.dealership_id:
                        # User must have a dealership to claim a lead
                        continue
                    
                    # Check if lead is in a different dealership (user can't claim it)
                    if lead.dealership_id is not None and lead.dealership_id != activity_user.dealership_id:
                        logger.debug(f"User {activity_user.id} can't claim lead {lead.id} - belongs to different dealership")
                        continue
                    
                    # Auto-assign to the user who performed the first activity
                    lead.assigned_to = first_activity.user_id
                    if lead.dealership_id is None:
                        # Only set dealership if lead is in global pool
                        lead.dealership_id = activity_user.dealership_id
                    lead.last_activity_at = utc_now()
                    
                    # Create assignment activity
                    activity = Activity(
                        type=ActivityType.LEAD_ASSIGNED,
                        description=f"Lead auto-assigned to {activity_user.first_name} {activity_user.last_name} based on first activity",
                        user_id=first_activity.user_id,
                        lead_id=lead.id,
                        dealership_id=activity_user.dealership_id,
                        meta_data={
                            "auto_assigned": True,
                            "reason": "first_activity",
                            "activity_type": first_activity.type.value if hasattr(first_activity.type, 'value') else str(first_activity.type),
                            "user_name": f"{activity_user.first_name} {activity_user.last_name}"
                        }
                    )
                    session.add(activity)
                    
                    # Create notification for the assigned user using NotificationService
                    notification_service = NotificationService(session)
                    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                    await notification_service.notify_lead_assigned(
                        user_id=first_activity.user_id,
                        lead_name=lead_name,
                        lead_id=lead.id,
                        assigned_by="System (auto-assignment)"
                    )
                    
                    # Emit WebSocket events for real-time updates
                    await ws_manager.send_to_user(
                        first_activity.user_id,
                        {
                            "type": "lead:updated",
                            "payload": {
                                "lead_id": str(lead.id),
                                "update_type": "assigned",
                                "assigned_to": str(first_activity.user_id)
                            }
                        }
                    )
                    
                    # Refresh badges
                    await ws_manager.send_to_user(
                        first_activity.user_id,
                        {"type": "badges:refresh", "payload": {}}
                    )
                    
                    assigned_count += 1
                    logger.info(f"Auto-assigned lead {lead.id} to user {first_activity.user_id} (dealership {activity_user.dealership_id})")
            
            if assigned_count > 0:
                await session.commit()
                logger.info(f"Auto-assigned {assigned_count} leads")
                
        except Exception as e:
            await session.rollback()
            logger.error(f"Auto-assign failed: {e}")


async def unassign_stale_leads():
    """
    Unassign leads that have had no activity BY THE ASSIGNED PERSON for 72 hours.
    
    Logic:
    - Find assigned leads (assigned_to is NOT NULL)
    - Check the last activity performed BY the assigned user on this lead
    - If more than 72 hours ago (or no activity by them), unassign
    - Clear both assigned_to AND dealership_id (back to unassigned pool)
    - Notify the original assignee
    
    This runs every hour.
    """
    logger.debug("Running stale lead unassignment check...")
    
    session_maker = get_assignment_session_maker()
    
    async with session_maker() as session:
        try:
            cutoff_time = utc_now() - timedelta(hours=STALE_HOURS)
            
            # Find all assigned leads with active statuses
            result = await session.execute(
                select(Lead)
                .options(selectinload(Lead.assigned_to_user))
                .where(
                    Lead.assigned_to.isnot(None),
                    Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.FOLLOW_UP, LeadStatus.INTERESTED])
                )
            )
            assigned_leads = result.scalars().all()
            
            if not assigned_leads:
                logger.debug("No assigned leads found")
                return
            
            unassigned_count = 0
            
            for lead in assigned_leads:
                # Check the last activity BY the assigned person on this lead
                last_activity_result = await session.execute(
                    select(Activity)
                    .where(
                        Activity.lead_id == lead.id,
                        Activity.user_id == lead.assigned_to
                    )
                    .order_by(Activity.created_at.desc())
                    .limit(1)
                )
                last_activity = last_activity_result.scalar_one_or_none()
                
                # Determine if stale
                is_stale = False
                if last_activity:
                    if last_activity.created_at < cutoff_time:
                        is_stale = True
                else:
                    # No activity by assigned user - check when lead was assigned
                    # Use last_activity_at (set during assignment) or created_at
                    check_time = lead.last_activity_at or lead.created_at
                    if check_time < cutoff_time:
                        is_stale = True
                
                if not is_stale:
                    continue
                
                old_assignee_id = lead.assigned_to
                old_dealership_id = lead.dealership_id
                old_assignee = lead.assigned_to_user
                
                # Unassign the lead AND remove from dealership (back to pool)
                lead.assigned_to = None
                lead.dealership_id = None
                lead.last_activity_at = None  # Reset for next assignment cycle
                
                # Create unassignment activity
                activity = Activity(
                    type=ActivityType.LEAD_UNASSIGNED,
                    description=f"Lead returned to unassigned pool due to {STALE_HOURS} hours of inactivity by assigned user",
                    lead_id=lead.id,
                    dealership_id=None,  # No longer associated with dealership
                    meta_data={
                        "auto_unassigned": True,
                        "reason": "stale_no_activity",
                        "hours_inactive": STALE_HOURS,
                        "previous_assignee_id": str(old_assignee_id) if old_assignee_id else None,
                        "previous_dealership_id": str(old_dealership_id) if old_dealership_id else None
                    }
                )
                session.add(activity)
                
                # Notify the original assignee using NotificationService
                if old_assignee_id:
                    notification_service = NotificationService(session)
                    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                    await notification_service.create_notification(
                        user_id=old_assignee_id,
                        notification_type=NotificationType.SYSTEM,
                        title="Lead Returned to Pool - No Activity",
                        message=f"Lead {lead_name} was returned to the unassigned pool due to {STALE_HOURS} hours of inactivity",
                        link=f"/leads/{lead.id}",
                        related_id=lead.id,
                        related_type="lead",
                        send_push=True
                    )
                    
                    # Emit WebSocket events
                    await ws_manager.send_to_user(
                        old_assignee_id,
                        {
                            "type": "lead:updated",
                            "payload": {
                                "lead_id": str(lead.id),
                                "update_type": "unassigned"
                            }
                        }
                    )
                    await ws_manager.send_to_user(
                        old_assignee_id,
                        {"type": "badges:refresh", "payload": {}}
                    )
                
                unassigned_count += 1
                logger.info(f"Returned stale lead {lead.id} to unassigned pool (was assigned to {old_assignee_id}, dealership {old_dealership_id})")
            
            if unassigned_count > 0:
                await session.commit()
                logger.info(f"Returned {unassigned_count} stale leads to unassigned pool")
                
                # Emit WebSocket event so sidebar unassigned count updates in real time
                try:
                    from app.services.notification_service import emit_badges_refresh
                    await emit_badges_refresh(unassigned=True)
                except Exception as e:
                    logger.warning(f"Failed to emit badges refresh: {e}")
                
                # Optionally send SMS notifications about available leads
                try:
                    from app.services.sms_service import sms_service
                    if sms_service.is_configured and unassigned_count > 0:
                        # Get all active users with phones and dealerships (potential claimers)
                        users_result = await session.execute(
                            select(User).where(
                                User.is_active == True,
                                User.dealership_id.isnot(None),
                                User.phone.isnot(None),
                                User.phone != ""
                            )
                        )
                        users = users_result.scalars().all()
                        
                        if users:
                            message = f"🔔 {unassigned_count} lead(s) now available in the pool!\nNo activity for {STALE_HOURS}h. First activity claims them!"
                            for user in users:
                                if user.phone:
                                    await sms_service.send_sms(user.phone, message)
                except Exception as sms_error:
                    logger.warning(f"Failed to send stale lead SMS notifications: {sms_error}")
                
        except Exception as e:
            await session.rollback()
            logger.error(f"Stale lead unassignment failed: {e}")


# Wrapper functions for scheduler
def run_auto_assign_task():
    """Wrapper for scheduler to run auto-assign"""
    import asyncio
    asyncio.run(auto_assign_leads_from_activity())


def run_stale_unassign_task():
    """Wrapper for scheduler to run stale unassignment"""
    import asyncio
    asyncio.run(unassign_stale_leads())
