"""
SKATE (Stealing Keeps All Teams Engaged) Helper
Provides utility functions for detecting and handling SKATE scenarios
"""
from typing import Optional, Dict, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.lead import Lead


async def check_skate_condition(
    db: AsyncSession,
    current_user: User,
    lead: Lead,
    action_type: str = "action"
) -> Optional[Dict[str, Any]]:
    """
    Check if the current action would be considered a SKATE.
    
    A SKATE occurs when:
    - Current user is a SALESPERSON
    - Lead is assigned to another user
    - Current user is not the assigned user
    
    Args:
        db: Database session
        current_user: The user performing the action
        lead: The lead being acted upon
        action_type: Type of action (e.g., "status change", "log call", "add note")
    
    Returns:
        None if not a SKATE scenario.
        Dict with skate_warning info if it is a SKATE scenario:
        {
            "skate_warning": True,
            "assigned_to_id": UUID,
            "assigned_to_name": str,
            "lead_name": str,
            "lead_id": UUID,
            "action_type": str,
            "message": str
        }
    """
    # Only check for salespersons
    if current_user.role != UserRole.SALESPERSON:
        return None
    
    # No SKATE if lead is not assigned
    if lead.assigned_to is None:
        return None
    
    # No SKATE if current user is the assigned user
    if lead.assigned_to == current_user.id:
        return None
    
    # This is a SKATE scenario - get assigned user details
    assigned_result = await db.execute(select(User).where(User.id == lead.assigned_to))
    assigned_user = assigned_result.scalar_one_or_none()
    
    assigned_to_name = "another salesperson"
    if assigned_user:
        assigned_to_name = f"{assigned_user.first_name} {assigned_user.last_name}"
    
    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "Lead"
    
    return {
        "skate_warning": True,
        "assigned_to_id": str(lead.assigned_to),
        "assigned_to_name": assigned_to_name,
        "lead_name": lead_name,
        "lead_id": str(lead.id),
        "action_type": action_type,
        "message": f"This lead is assigned to {assigned_to_name}. If you continue, this will be logged as a SKATE and the team will be notified."
    }


async def check_note_skate_condition(
    db: AsyncSession,
    current_user: User,
    lead: Lead,
    mentioned_user_ids: Optional[list] = None
) -> Optional[Dict[str, Any]]:
    """
    Check if adding a note would be considered a SKATE.
    
    For notes, a SKATE occurs when:
    - Current user is a SALESPERSON
    - Lead is assigned to another user
    - The assigned user is NOT mentioned in the note
    
    If the assigned user IS mentioned, it's not a SKATE.
    
    Args:
        db: Database session
        current_user: The user performing the action
        lead: The lead being acted upon
        mentioned_user_ids: List of user IDs mentioned in the note
    
    Returns:
        None if not a SKATE scenario (including when assigned user is mentioned).
        Dict with skate_warning info if it is a SKATE scenario.
    """
    # Only check for salespersons
    if current_user.role != UserRole.SALESPERSON:
        return None
    
    # No SKATE if lead is not assigned
    if lead.assigned_to is None:
        return None
    
    # No SKATE if current user is the assigned user
    if lead.assigned_to == current_user.id:
        return None
    
    # Check if assigned user is mentioned
    if mentioned_user_ids:
        if lead.assigned_to in mentioned_user_ids or str(lead.assigned_to) in [str(uid) for uid in mentioned_user_ids]:
            return None  # Assigned user is mentioned, not a SKATE
    
    # This is a SKATE scenario - get assigned user details
    assigned_result = await db.execute(select(User).where(User.id == lead.assigned_to))
    assigned_user = assigned_result.scalar_one_or_none()
    
    assigned_to_name = "another salesperson"
    if assigned_user:
        assigned_to_name = f"{assigned_user.first_name} {assigned_user.last_name}"
    
    lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "Lead"
    
    return {
        "skate_warning": True,
        "assigned_to_id": str(lead.assigned_to),
        "assigned_to_name": assigned_to_name,
        "lead_name": lead_name,
        "lead_id": str(lead.id),
        "action_type": "add note",
        "message": f"This lead is assigned to {assigned_to_name}. To avoid a SKATE, mention @{assigned_to_name} in your note. If you continue without mentioning, this will be logged as a SKATE and the team will be notified.",
        "mention_hint": f"To avoid this, mention @{assigned_to_name} in your note."
    }
