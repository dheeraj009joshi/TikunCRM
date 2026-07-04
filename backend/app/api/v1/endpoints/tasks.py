"""
Task Endpoints — generalized work items with a My Day queue.
"""
import math
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.core.access_scope import get_accessible_dealership_ids
from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.lead import Lead
from app.models.task import Task, TaskPriority, TaskStatus, TaskType
from app.models.user import User
from app.schemas.task import (
    TaskCreate,
    TaskListResponse,
    TaskResponse,
    TaskStats,
    TaskUpdate,
)

router = APIRouter()


async def _scope_filters(db: AsyncSession, current_user: User) -> list:
    """RBAC scoping: salespeople see their own tasks, managers see their store's."""
    if current_user.role == UserRole.SUPER_ADMIN:
        return []
    if current_user.role == UserRole.SALESPERSON:
        return [Task.assigned_to == current_user.id]
    if current_user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        user_ids_subq = select(User.id).where(User.dealership_id == current_user.dealership_id)
        return [Task.assigned_to.in_(user_ids_subq)]
    if current_user.role == UserRole.BDC:
        accessible = await get_accessible_dealership_ids(db, current_user)
        if not accessible:
            return [Task.id.is_(None)]
        return [
            (Task.assigned_to == current_user.id)
            | Task.dealership_id.in_(accessible)
        ]
    return [Task.assigned_to == current_user.id]


def _serialize(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        task_type=task.task_type,
        priority=task.priority,
        status=task.status,
        due_at=task.due_at,
        lead_id=task.lead_id,
        dealership_id=task.dealership_id,
        assigned_to=task.assigned_to,
        created_by=task.created_by,
        completed_at=task.completed_at,
        completion_notes=task.completion_notes,
        created_at=task.created_at,
        updated_at=task.updated_at,
        lead={
            "id": task.lead.id,
            "first_name": task.lead.first_name,
            "last_name": task.lead.last_name,
            "phone": task.lead.phone,
        }
        if task.lead
        else None,
        assigned_to_user={
            "id": task.assigned_to_user.id,
            "first_name": task.assigned_to_user.first_name,
            "last_name": task.assigned_to_user.last_name,
            "email": task.assigned_to_user.email,
        }
        if task.assigned_to_user
        else None,
    )


@router.get("/", response_model=TaskListResponse)
async def list_tasks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Optional[TaskStatus] = Query(None, alias="status"),
    task_type: Optional[TaskType] = Query(None),
    priority: Optional[TaskPriority] = Query(None),
    lead_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    due_today: bool = Query(False, description="My Day: due today or overdue"),
    overdue: bool = Query(False),
) -> Any:
    """List tasks with RBAC scoping, filters, and stats."""
    scope = await _scope_filters(db, current_user)
    filters = list(scope)

    if status_filter:
        filters.append(Task.status == status_filter)
    if task_type:
        filters.append(Task.task_type == task_type)
    if priority:
        filters.append(Task.priority == priority)
    if lead_id:
        filters.append(Task.lead_id == lead_id)
    if assigned_to:
        filters.append(Task.assigned_to == assigned_to)

    now = utc_now()
    if due_today:
        end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        filters.append(Task.status == TaskStatus.PENDING)
        filters.append(Task.due_at <= end_of_day)
    elif overdue:
        filters.append(Task.status == TaskStatus.PENDING)
        filters.append(Task.due_at < now)

    # Stats over the RBAC scope only (ignoring status filters)
    async def _count(*extra) -> int:
        q = select(func.count(Task.id))
        conds = scope + list(extra)
        if conds:
            q = q.where(and_(*conds))
        return (await db.execute(q)).scalar() or 0

    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    stats = TaskStats(
        total=await _count(),
        pending=await _count(Task.status == TaskStatus.PENDING),
        overdue=await _count(Task.status == TaskStatus.PENDING, Task.due_at < now),
        due_today=await _count(
            Task.status == TaskStatus.PENDING,
            Task.due_at >= start_of_day,
            Task.due_at <= end_of_day,
        ),
        completed=await _count(Task.status == TaskStatus.COMPLETED),
    )

    count_q = select(func.count(Task.id))
    if filters:
        count_q = count_q.where(and_(*filters))
    total = (await db.execute(count_q)).scalar() or 0
    total_pages = math.ceil(total / page_size) if total else 0

    q = (
        select(Task)
        .options(selectinload(Task.lead), selectinload(Task.assigned_to_user))
        .order_by(Task.due_at.asc().nulls_last(), Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if filters:
        q = q.where(and_(*filters))
    tasks = (await db.execute(q)).scalars().all()

    return TaskListResponse(
        items=[_serialize(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        stats=stats,
    )


@router.post("/", response_model=TaskResponse, status_code=201)
async def create_task(
    task_in: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Create a task, defaulting assignment to the current user."""
    dealership_id = current_user.dealership_id
    if task_in.lead_id:
        lead = (await db.execute(select(Lead).where(Lead.id == task_in.lead_id))).scalar_one_or_none()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        dealership_id = lead.dealership_id or dealership_id

    task = Task(
        title=task_in.title,
        description=task_in.description,
        task_type=task_in.task_type,
        priority=task_in.priority,
        due_at=task_in.due_at,
        lead_id=task_in.lead_id,
        dealership_id=dealership_id,
        assigned_to=task_in.assigned_to or current_user.id,
        created_by=current_user.id,
    )
    db.add(task)
    await db.commit()

    result = await db.execute(
        select(Task)
        .options(selectinload(Task.lead), selectinload(Task.assigned_to_user))
        .where(Task.id == task.id)
    )
    return _serialize(result.scalar_one())


async def _get_owned_task(db: AsyncSession, current_user: User, task_id: UUID) -> Task:
    result = await db.execute(
        select(Task)
        .options(selectinload(Task.lead), selectinload(Task.assigned_to_user))
        .where(Task.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if current_user.role == UserRole.SALESPERSON and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if current_user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        assignee = (await db.execute(select(User).where(User.id == task.assigned_to))).scalar_one_or_none()
        if assignee and assignee.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized")
    return task


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    task_in: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """Update a task; completing sets completed_at."""
    task = await _get_owned_task(db, current_user, task_id)
    data = task_in.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(task, key, value)
    if data.get("status") == TaskStatus.COMPLETED and not task.completed_at:
        task.completed_at = utc_now()
    if data.get("status") == TaskStatus.PENDING:
        task.completed_at = None
    await db.commit()
    await db.refresh(task)
    return _serialize(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> None:
    task = await _get_owned_task(db, current_user, task_id)
    await db.delete(task)
    await db.commit()
