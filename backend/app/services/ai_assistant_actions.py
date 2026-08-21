"""
Tikun AI write actions — executed only after user confirms in chat.
Respects the same RBAC / dealership scope as the rest of the CRM:
- super_admin: all dealerships
- dealership_admin / owner: own dealership
- bdc: all leads in accessible dealerships (multi-store junction)
- salesperson: dealership leads (AI defaults search pool to mine)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access_scope import (
    get_accessible_dealership_ids,
    user_can_access_dealership,
    user_can_access_lead,
)
from app.core.permissions import Permission, UserRole, has_permission
from app.core.timezone import utc_now
from app.models.activity import ActivityType
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.models.user import User
from app.services.activity import ActivityService
from app.services.lead_stage_service import LeadStageService

logger = logging.getLogger(__name__)

WRITE_TOOL_NAMES = frozenset(
    {"assign_leads", "update_lead_stages", "create_follow_ups"}
)


def _parse_uuids(raw: Any) -> List[UUID]:
    out: List[UUID] = []
    if not raw:
        return out
    for item in raw:
        try:
            out.append(UUID(str(item)))
        except (ValueError, TypeError):
            continue
    return out


async def _user_dealership_scope(
    db: AsyncSession, user: User
) -> Optional[List[UUID]]:
    """None = unrestricted (super_admin). [] = none."""
    return await get_accessible_dealership_ids(db, user)


def _apply_user_dealership_filter(stmt, scope: Optional[List[UUID]]):
    if scope is None:
        return stmt
    if not scope:
        return stmt.where(User.id.is_(None))
    return stmt.where(User.dealership_id.in_(scope))


def _role_scope_note(user: User) -> str:
    if user.role == UserRole.SUPER_ADMIN:
        return "You can see all dealerships."
    if user.role == UserRole.BDC:
        return (
            "You can see all leads in your accessible dealerships "
            "(not limited to leads assigned to you)."
        )
    if user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        return "You can see all leads in your dealership."
    if user.role == UserRole.SALESPERSON:
        return (
            "Default searches use your assigned leads (pool=mine); "
            "you can ask for all dealership leads."
        )
    return "Access is limited by your role."


async def resolve_salesperson(
    db: AsyncSession,
    user: User,
    *,
    user_id: Optional[str] = None,
    name: Optional[str] = None,
    for_dealership_id: Optional[UUID] = None,
) -> Optional[User]:
    scope = await _user_dealership_scope(db, user)

    if user_id:
        try:
            uid = UUID(str(user_id))
        except (ValueError, TypeError):
            return None
        res = await db.execute(
            select(User).where(User.id == uid, User.is_active == True)  # noqa: E712
        )
        candidate = res.scalar_one_or_none()
        if not candidate:
            return None
        if scope is not None and candidate.dealership_id not in scope:
            return None
        if for_dealership_id and candidate.dealership_id != for_dealership_id:
            return None
        return candidate

    if not name or not name.strip():
        return None
    q = name.strip()
    stmt = select(User).where(User.is_active == True)  # noqa: E712
    stmt = _apply_user_dealership_filter(stmt, scope)
    if for_dealership_id:
        if scope is not None and for_dealership_id not in scope:
            return None
        stmt = stmt.where(User.dealership_id == for_dealership_id)
    stmt = stmt.where(
        or_(
            User.first_name.ilike(f"%{q}%"),
            User.last_name.ilike(f"%{q}%"),
            func.concat(User.first_name, " ", User.last_name).ilike(f"%{q}%"),
        )
    ).limit(5)
    res = await db.execute(stmt)
    matches = list(res.scalars().all())
    if len(matches) == 1:
        return matches[0]
    ql = q.lower()
    for m in matches:
        full = f"{m.first_name or ''} {m.last_name or ''}".strip().lower()
        if full == ql:
            return m
    return matches[0] if matches else None


async def list_salespersons(
    db: AsyncSession, user: User, args: Optional[dict] = None
) -> Dict[str, Any]:
    """Assignable people in caller's dealership scope (BDC = all accessible stores)."""
    args = args or {}
    scope = await _user_dealership_scope(db, user)

    dealership_id = None
    if args.get("dealership_id"):
        try:
            dealership_id = UUID(str(args["dealership_id"]))
        except (ValueError, TypeError):
            return {"error": "Invalid dealership_id"}
        if not await user_can_access_dealership(db, user, dealership_id):
            return {"error": "Not authorized for this dealership"}

    stmt = select(User).where(
        User.is_active == True,  # noqa: E712
        User.role.in_(
            [
                UserRole.SALESPERSON,
                UserRole.DEALERSHIP_ADMIN,
                UserRole.DEALERSHIP_OWNER,
            ]
        ),
    )
    if dealership_id:
        stmt = stmt.where(User.dealership_id == dealership_id)
    else:
        stmt = _apply_user_dealership_filter(stmt, scope)

    stmt = stmt.order_by(User.first_name).limit(100)
    res = await db.execute(stmt)
    people = [
        {
            "id": str(u.id),
            "name": f"{u.first_name or ''} {u.last_name or ''}".strip(),
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "dealership_id": str(u.dealership_id) if u.dealership_id else None,
        }
        for u in res.scalars().all()
    ]
    return {"salespersons": people, "scope_note": _role_scope_note(user)}


async def propose_assign_leads(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    if not has_permission(user.role, Permission.ASSIGN_LEAD_TO_SALESPERSON):
        return {"error": "You do not have permission to assign leads"}

    lead_ids = _parse_uuids(args.get("lead_ids"))
    if not lead_ids:
        return {"error": "lead_ids required"}

    for_dealership_id = None
    first = await db.execute(select(Lead).where(Lead.id == lead_ids[0]))
    first_lead = first.scalar_one_or_none()
    if first_lead and first_lead.dealership_id:
        if await user_can_access_dealership(db, user, first_lead.dealership_id):
            for_dealership_id = first_lead.dealership_id

    assignee = await resolve_salesperson(
        db,
        user,
        user_id=args.get("assigned_to"),
        name=args.get("assigned_to_name"),
        for_dealership_id=for_dealership_id,
    )
    if not assignee:
        return {
            "error": "Could not resolve salesperson in your dealership scope. Use list_salespersons.",
        }

    return {
        "status": "pending_confirmation",
        "tool": "assign_leads",
        "summary": f"Assign {len(lead_ids)} lead(s) to {assignee.first_name} {assignee.last_name}",
        "args": {
            "lead_ids": [str(x) for x in lead_ids],
            "assigned_to": str(assignee.id),
            "assigned_to_name": f"{assignee.first_name or ''} {assignee.last_name or ''}".strip(),
            "notes": args.get("notes"),
        },
    }


async def propose_update_stages(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    lead_ids = _parse_uuids(args.get("lead_ids"))
    if not lead_ids:
        return {"error": "lead_ids required"}

    stage_id = args.get("stage_id")
    stage_name = args.get("stage_name")
    stage = None
    if stage_id:
        try:
            stage = await LeadStageService.get_stage(db, UUID(str(stage_id)))
        except (ValueError, TypeError):
            stage = None
    if not stage and stage_name:
        scope = await _user_dealership_scope(db, user)
        dealership_for_stage = user.dealership_id
        if not dealership_for_stage and scope:
            dealership_for_stage = scope[0]
        stage = await LeadStageService.get_stage_by_name(
            db, str(stage_name), dealership_for_stage
        )
    if not stage:
        return {"error": "Could not resolve stage. Call list_stages first."}

    if stage.is_terminal and user.role == UserRole.SALESPERSON:
        return {"error": "Only admins can move leads to terminal stages"}

    return {
        "status": "pending_confirmation",
        "tool": "update_lead_stages",
        "summary": f"Move {len(lead_ids)} lead(s) to {stage.display_name}",
        "args": {
            "lead_ids": [str(x) for x in lead_ids],
            "stage_id": str(stage.id),
            "stage_name": stage.display_name,
            "notes": args.get("notes"),
        },
    }


async def propose_follow_ups(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    lead_ids = _parse_uuids(args.get("lead_ids"))
    if not lead_ids:
        return {"error": "lead_ids required"}

    due_raw = args.get("scheduled_at") or args.get("due_at")
    if not due_raw:
        return {"error": "scheduled_at (ISO datetime) is required"}
    try:
        if isinstance(due_raw, str):
            due = datetime.fromisoformat(due_raw.replace("Z", "+00:00"))
        else:
            return {"error": "scheduled_at must be an ISO string"}
    except ValueError:
        return {"error": f"Invalid scheduled_at: {due_raw}"}

    return {
        "status": "pending_confirmation",
        "tool": "create_follow_ups",
        "summary": f"Create follow-up for {len(lead_ids)} lead(s) at {due.isoformat()}",
        "args": {
            "lead_ids": [str(x) for x in lead_ids],
            "scheduled_at": due.isoformat(),
            "notes": args.get("notes") or "Scheduled via Tikun AI",
        },
    }


async def execute_assign_leads(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    if not has_permission(user.role, Permission.ASSIGN_LEAD_TO_SALESPERSON):
        return {"ok": False, "error": "No permission to assign leads"}

    lead_ids = _parse_uuids(args.get("lead_ids"))
    try:
        assignee_id = UUID(str(args["assigned_to"]))
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "error": "assigned_to required"}

    ures = await db.execute(select(User).where(User.id == assignee_id))
    assignee = ures.scalar_one_or_none()
    if not assignee:
        return {"ok": False, "error": "Assignee not found"}

    if not await user_can_access_dealership(db, user, assignee.dealership_id):
        return {"ok": False, "error": "Assignee is outside your dealership access"}

    ok, errors = 0, []
    for lid in lead_ids:
        res = await db.execute(select(Lead).where(Lead.id == lid))
        lead = res.scalar_one_or_none()
        if not lead:
            errors.append({"lead_id": str(lid), "error": "not found"})
            continue

        if not await user_can_access_lead(
            db, user, lead.dealership_id, lead.assigned_to
        ):
            errors.append({"lead_id": str(lid), "error": "no access"})
            continue

        # Same-store rule (matches POST /leads/{id}/assign for BDC/admin)
        if user.role != UserRole.SUPER_ADMIN:
            if not lead.dealership_id:
                errors.append({"lead_id": str(lid), "error": "lead has no dealership"})
                continue
            if assignee.dealership_id != lead.dealership_id:
                errors.append(
                    {
                        "lead_id": str(lid),
                        "error": "cannot assign to user in a different dealership",
                    }
                )
                continue

        old = lead.assigned_to
        lead.assigned_to = assignee_id
        lead.clear_returned_to_pool_state()
        lead.last_activity_at = utc_now()
        name = f"{assignee.first_name} {assignee.last_name}"
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.LEAD_ASSIGNED,
            description=(
                f"Lead assigned to {name} by Tikun AI "
                f"({user.first_name} {user.last_name})"
            ),
            user_id=user.id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
            meta_data={
                "assigned_to": str(assignee_id),
                "via": "tikun_ai",
                "notes": args.get("notes"),
                "old_assigned_to": str(old) if old else None,
            },
        )
        ok += 1

    await db.flush()
    return {"ok": True, "assigned": ok, "errors": errors}


async def execute_update_stages(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    lead_ids = _parse_uuids(args.get("lead_ids"))
    try:
        stage_id = UUID(str(args["stage_id"]))
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "error": "stage_id required"}

    stage = await LeadStageService.get_stage(db, stage_id)
    if not stage:
        return {"ok": False, "error": "Stage not found"}
    if stage.is_terminal and user.role == UserRole.SALESPERSON:
        return {"ok": False, "error": "Only admins can close leads"}

    ok, errors = 0, []
    for lid in lead_ids:
        res = await db.execute(select(Lead).where(Lead.id == lid))
        lead = res.scalar_one_or_none()
        if not lead:
            errors.append({"lead_id": str(lid), "error": "not found"})
            continue
        if not await user_can_access_lead(
            db, user, lead.dealership_id, lead.assigned_to
        ):
            errors.append({"lead_id": str(lid), "error": "no access"})
            continue
        old_stage = await LeadStageService.get_stage(db, lead.stage_id)
        lead.stage_id = stage.id
        lead.last_activity_at = utc_now()
        if stage.is_terminal:
            lead.is_active = False
            if stage.name == "converted":
                lead.converted_at = utc_now()
            lead.closed_at = utc_now()
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.STATUS_CHANGED,
            description=f"Stage changed to {stage.display_name} via Tikun AI",
            user_id=user.id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
            meta_data={
                "stage_id": str(stage.id),
                "stage_name": stage.display_name,
                "old_stage": old_stage.display_name if old_stage else None,
                "via": "tikun_ai",
            },
        )
        ok += 1

    await db.flush()
    return {"ok": True, "updated": ok, "errors": errors}


async def execute_create_follow_ups(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    lead_ids = _parse_uuids(args.get("lead_ids"))
    try:
        due = datetime.fromisoformat(str(args["scheduled_at"]).replace("Z", "+00:00"))
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "error": "Invalid scheduled_at"}

    notes = args.get("notes") or "Scheduled via Tikun AI"
    ok, errors = 0, []
    for lid in lead_ids:
        res = await db.execute(select(Lead).where(Lead.id == lid))
        lead = res.scalar_one_or_none()
        if not lead:
            errors.append({"lead_id": str(lid), "error": "not found"})
            continue
        if not await user_can_access_lead(
            db, user, lead.dealership_id, lead.assigned_to
        ):
            errors.append({"lead_id": str(lid), "error": "no access"})
            continue
        assigned_to = lead.assigned_to or user.id
        fu = FollowUp(
            lead_id=lid,
            assigned_to=assigned_to,
            scheduled_at=due,
            notes=notes,
            status=FollowUpStatus.PENDING,
        )
        db.add(fu)
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.FOLLOW_UP_SCHEDULED,
            description=(
                f"Follow-up scheduled for {due.strftime('%Y-%m-%d %H:%M')} via Tikun AI"
            ),
            user_id=user.id,
            lead_id=lid,
            dealership_id=lead.dealership_id,
            meta_data={"via": "tikun_ai", "scheduled_at": due.isoformat()},
        )
        ok += 1

    await db.flush()
    return {"ok": True, "created": ok, "errors": errors}


async def execute_pending_actions(
    db: AsyncSession, user: User, actions: List[dict]
) -> Dict[str, Any]:
    results = []
    for action in actions:
        tool = action.get("tool")
        args = action.get("args") or {}
        if tool == "assign_leads":
            results.append({"tool": tool, **await execute_assign_leads(db, user, args)})
        elif tool == "update_lead_stages":
            results.append(
                {"tool": tool, **await execute_update_stages(db, user, args)}
            )
        elif tool == "create_follow_ups":
            results.append(
                {"tool": tool, **await execute_create_follow_ups(db, user, args)}
            )
        else:
            results.append({"tool": tool, "ok": False, "error": "Unknown action"})
    await db.commit()
    return {"results": results}


async def rank_leads_to_call(
    db: AsyncSession, user: User, args: dict
) -> Dict[str, Any]:
    """Same lead visibility as search_leads / GET /leads/."""
    from app.services.ai_assistant_service import AiAssistantService

    default_pool = "mine" if user.role == UserRole.SALESPERSON else None
    search_args = {
        "pool": args.get("pool") if args.get("pool") is not None else default_pool,
        "is_active": True,
        "page_size": min(int(args.get("limit") or 15), 25),
        "has_ssn_stip": args.get("has_ssn_stip"),
        "has_dl_stip": args.get("has_dl_stip"),
        "has_license": args.get("has_license"),
        "is_business": args.get("is_business"),
        "down_min": args.get("down_min"),
        "down_max": args.get("down_max"),
        "dealership_id": args.get("dealership_id"),
    }
    search_args = {k: v for k, v in search_args.items() if v is not None}
    raw = await AiAssistantService._tool_search_leads(db, user, search_args)
    leads = raw.get("leads") or []

    ranked = []
    for lead in leads:
        score = 50
        reasons: List[str] = []
        if lead.get("has_ssn_stip") and lead.get("has_dl_stip"):
            score += 25
            reasons.append("SSN + DL stips ready")
        elif lead.get("has_dl_stip") or lead.get("has_ssn_stip"):
            score += 10
            reasons.append("partial stips")
        if lead.get("is_business") is True:
            score += 5
            reasons.append("business")
        dp = lead.get("down_payment")
        if dp is not None and 2000 <= float(dp) <= 5000:
            score += 15
            reasons.append(f"solid down ${float(dp):,.0f}")
        elif dp is not None and float(dp) >= 1000:
            score += 8
            reasons.append("has down payment")
        stage = (lead.get("stage") or "").lower()
        if "appointment" in stage or "follow" in stage or "interested" in stage:
            score += 12
            reasons.append(f"stage: {lead.get('stage')}")
        if "new" in stage or "contacted" in stage:
            score += 5
        ranked.append(
            {
                **lead,
                "priority_score": score,
                "reasons": reasons or ["in your accessible pipeline"],
                "rank": 0,
            }
        )

    ranked.sort(key=lambda x: x["priority_score"], reverse=True)
    for i, row in enumerate(ranked):
        row["rank"] = i + 1

    return {
        "total_considered": raw.get("total", len(ranked)),
        "ranked": ranked[: int(args.get("limit") or 10)],
        "filter_params": raw.get("filter_params") or search_args,
        "scope_note": _role_scope_note(user),
    }
