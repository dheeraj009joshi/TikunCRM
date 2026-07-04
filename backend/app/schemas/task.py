"""
Task Schemas
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.task import TaskPriority, TaskStatus, TaskType


class TaskLeadBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None


class TaskUserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    email: str


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    task_type: TaskType = TaskType.TODO
    priority: TaskPriority = TaskPriority.MEDIUM
    due_at: Optional[datetime] = None
    lead_id: Optional[UUID] = None
    assigned_to: Optional[UUID] = None  # defaults to current user


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    task_type: Optional[TaskType] = None
    priority: Optional[TaskPriority] = None
    status: Optional[TaskStatus] = None
    due_at: Optional[datetime] = None
    assigned_to: Optional[UUID] = None
    completion_notes: Optional[str] = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: Optional[str] = None
    task_type: TaskType
    priority: TaskPriority
    status: TaskStatus
    due_at: Optional[datetime] = None
    lead_id: Optional[UUID] = None
    dealership_id: Optional[UUID] = None
    assigned_to: UUID
    created_by: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    lead: Optional[TaskLeadBrief] = None
    assigned_to_user: Optional[TaskUserBrief] = None


class TaskStats(BaseModel):
    total: int
    pending: int
    overdue: int
    due_today: int
    completed: int


class TaskListResponse(BaseModel):
    items: List[TaskResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    stats: TaskStats
