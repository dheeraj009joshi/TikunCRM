"""
Tikun AI assistant endpoints — ChatGPT-style streaming chat.
"""
import logging
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.db.database import get_db
from app.models.user import User
from app.schemas.ai_assistant import (
    AiChatRequest,
    AiConfirmRequest,
    AiConversationBrief,
    AiConversationResponse,
)
from app.services.ai_assistant_service import AiAssistantService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/status")
async def ai_status(
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    return {
        "enabled": bool(settings.ai_assistant_enabled and settings.openai_api_key),
        "model": settings.ai_assistant_model,
    }


@router.get("/conversations", response_model=List[AiConversationBrief])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    return await AiAssistantService.list_conversations(db, current_user.id)


@router.get("/conversations/{conversation_id}", response_model=AiConversationResponse)
async def get_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    conv = await AiAssistantService.get_conversation(db, conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    ok = await AiAssistantService.delete_conversation(db, conversation_id, current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.commit()
    return {"message": "Deleted"}


@router.post("/confirm")
async def confirm_actions(
    body: AiConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Execute write actions the user confirmed in the chat UI."""
    if not body.actions:
        raise HTTPException(status_code=400, detail="No actions to confirm")
    result = await AiAssistantService.confirm_actions(
        db, current_user, [a.model_dump() for a in body.actions]
    )

    # Append a short assistant note to the conversation when provided
    if body.conversation_id:
        conv = await AiAssistantService.get_conversation(
            db, body.conversation_id, current_user.id
        )
        if conv:
            from app.models.ai_assistant import AiMessage
            from app.core.timezone import utc_now

            lines = []
            for r in result.get("results") or []:
                tool = r.get("tool")
                if r.get("ok"):
                    if tool == "assign_leads":
                        lines.append(f"Assigned {r.get('assigned', 0)} lead(s).")
                    elif tool == "update_lead_stages":
                        lines.append(f"Updated stage on {r.get('updated', 0)} lead(s).")
                    elif tool == "create_follow_ups":
                        lines.append(f"Created {r.get('created', 0)} follow-up(s).")
                    else:
                        lines.append(f"{tool}: done.")
                else:
                    lines.append(f"{tool} failed: {r.get('error') or 'error'}")
            note = " ".join(lines) or "Actions processed."
            db.add(
                AiMessage(
                    conversation_id=conv.id,
                    role="assistant",
                    content=note,
                    thinking=None,
                    tool_traces=[{"name": "confirm", "result_summary": note}],
                    ui_blocks=[],
                )
            )
            conv.updated_at = utc_now()
            await db.commit()
            result["message"] = note

    return result


@router.post("/chat/stream")
async def chat_stream(
    body: AiChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> StreamingResponse:
    """SSE stream: thinking → tools → message → done."""

    async def event_gen():
        try:
            async for chunk in AiAssistantService.stream_chat(
                db,
                current_user,
                body.message.strip(),
                conversation_id=body.conversation_id,
            ):
                yield chunk
        except Exception as e:
            logger.exception("AI chat stream failed")
            import json

            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
