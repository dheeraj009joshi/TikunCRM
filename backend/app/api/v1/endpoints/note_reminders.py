"""
Note reminders API: callbacks and deadlines the AI found in a lead's notes.

GET  /note-reminders/leads/{lead_id}        suggestions waiting for a decision
POST /note-reminders/leads/{lead_id}/scan   read the notes again if they changed
POST /note-reminders/{id}/accept            link the follow-up that was created
POST /note-reminders/{id}/dismiss           not needed
"""
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.access_scope import user_can_access_lead
from app.db.database import get_db
from app.models.lead import Lead
from app.models.note_reminder import NoteReminder
from app.models.user import User
from app.services import note_reminders_service as service

router = APIRouter()


async def _lead_for(db: AsyncSession, lead_id: UUID, user: User) -> Any:
    """Just the lead's id, dealership and owner (skips the customer and stage joins)."""
    lead = (
        await db.execute(select(Lead.id, Lead.dealership_id, Lead.assigned_to).where(Lead.id == lead_id))
    ).one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await user_can_access_lead(db, user, lead.dealership_id, lead.assigned_to):
        raise HTTPException(status_code=403, detail="You can't see reminders for this lead")
    return lead


@router.get("/leads/{lead_id}")
async def list_note_reminders(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Dict[str, Any]:
    lead = await _lead_for(db, lead_id, current_user)
    return await service.list_for_lead(db, lead)


@router.post("/leads/{lead_id}/scan")
async def scan_note_reminders(
    lead_id: UUID,
    force: bool = Query(False, description="Read the notes again even if they haven't changed"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Dict[str, Any]:
    lead = await _lead_for(db, lead_id, current_user)
    try:
        await service.scan_lead(db, lead, force=force)
    except service.NoteRemindersUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reading notes needs an AI key on the server (OPENAI_API_KEY).",
        )
    await db.commit()
    return await service.list_for_lead(db, lead)


class AcceptBody(BaseModel):
    follow_up_id: UUID


async def _reminder_for(db: AsyncSession, reminder_id: UUID, user: User) -> NoteReminder:
    reminder = await db.get(NoteReminder, reminder_id)
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    await _lead_for(db, reminder.lead_id, user)
    return reminder


async def _decide(
    db: AsyncSession, reminder: NoteReminder, user: User, accept: bool, follow_up_id: Optional[UUID]
) -> Dict[str, Any]:
    try:
        await service.decide(db, reminder, user, accept=accept, follow_up_id=follow_up_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return {"id": str(reminder.id), "status": reminder.status}


@router.post("/{reminder_id}/accept")
async def accept_note_reminder(
    reminder_id: UUID,
    body: AcceptBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Dict[str, Any]:
    reminder = await _reminder_for(db, reminder_id, current_user)
    return await _decide(db, reminder, current_user, True, body.follow_up_id)


@router.post("/{reminder_id}/dismiss")
async def dismiss_note_reminder(
    reminder_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Dict[str, Any]:
    reminder = await _reminder_for(db, reminder_id, current_user)
    return await _decide(db, reminder, current_user, False, None)
