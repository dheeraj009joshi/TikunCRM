"""
Schemas for Tikun AI assistant.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class AiChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    conversation_id: Optional[UUID] = None


class AiPendingAction(BaseModel):
    tool: str
    args: Dict[str, Any] = Field(default_factory=dict)
    summary: Optional[str] = None


class AiConfirmRequest(BaseModel):
    conversation_id: Optional[UUID] = None
    actions: List[AiPendingAction] = Field(default_factory=list)


class AiMessageResponse(BaseModel):
    id: UUID
    role: str
    content: str
    thinking: Optional[str] = None
    tool_traces: List[Dict[str, Any]] = Field(default_factory=list)
    ui_blocks: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: datetime

    class Config:
        from_attributes = True


class AiConversationResponse(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: List[AiMessageResponse] = Field(default_factory=list)

    class Config:
        from_attributes = True


class AiConversationBrief(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
