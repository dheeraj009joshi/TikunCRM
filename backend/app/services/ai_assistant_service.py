"""
Tikun AI — ChatGPT-style CRM assistant with tool calling + SSE events.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, AsyncIterator, Dict, List, Optional
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.ai_assistant import AiConversation, AiMessage
from app.models.lead import Lead
from app.models.user import User
from app.core.permissions import UserRole

logger = logging.getLogger(__name__)

SEARCH_LEADS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_leads",
        "description": (
            "Search CRM leads the current user can see (same visibility as the Leads page). "
            "BDC/admin/owner see all leads in their dealership scope — do NOT default pool=mine for them. "
            "Salespeople default to pool=mine unless they ask for all. "
            "SSN/DL mean stip documents uploaded (has_ssn_stip / has_dl_stip), not stored ID numbers."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pool": {
                    "type": "string",
                    "enum": ["mine", "unassigned"],
                    "description": (
                        "mine = assigned to current user; unassigned = no salesperson. "
                        "Omit for all leads the role can see (required for BDC browsing)."
                    ),
                },
                "dealership_id": {
                    "type": "string",
                    "description": "Filter to one dealership (BDC multi-store / super admin)",
                },
                "search": {"type": "string", "description": "Name/email/phone search"},
                "down_min": {"type": "number"},
                "down_max": {"type": "number"},
                "has_ssn_stip": {"type": "boolean"},
                "has_dl_stip": {"type": "boolean"},
                "has_license": {"type": "boolean"},
                "is_business": {
                    "type": "boolean",
                    "description": "Trust-score Business Yes (true) / No (false)",
                },
                "stage_id": {"type": "string", "description": "Pipeline stage UUID if known"},
                "source": {"type": "string"},
                "is_active": {"type": "boolean"},
                "fresh_only": {"type": "boolean"},
                "page_size": {"type": "integer", "description": "Max 50"},
            },
        },
    },
}

LIST_STAGES_TOOL = {
    "type": "function",
    "function": {
        "name": "list_stages",
        "description": "List pipeline stage names and IDs for resolving stage filters.",
        "parameters": {"type": "object", "properties": {}},
    },
}

LIST_SALESPERSONS_TOOL = {
    "type": "function",
    "function": {
        "name": "list_salespersons",
        "description": (
            "List salespeople/admins who can be assigned leads (id + name). "
            "Scoped to the caller's dealership access. BDC may pass dealership_id "
            "to narrow to one store."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "dealership_id": {
                    "type": "string",
                    "description": "Optional dealership UUID (useful for BDC multi-store)",
                },
            },
        },
    },
}

ASSIGN_LEADS_TOOL = {
    "type": "function",
    "function": {
        "name": "assign_leads",
        "description": (
            "Propose assigning leads to a salesperson. Does NOT run until the user confirms "
            "in the UI. Prefer assigned_to UUID from list_salespersons; or assigned_to_name."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "lead_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Lead UUIDs from a prior search_leads result",
                },
                "assigned_to": {"type": "string", "description": "User UUID"},
                "assigned_to_name": {
                    "type": "string",
                    "description": "Name to resolve if UUID unknown",
                },
                "notes": {"type": "string"},
            },
            "required": ["lead_ids"],
        },
    },
}

UPDATE_STAGES_TOOL = {
    "type": "function",
    "function": {
        "name": "update_lead_stages",
        "description": (
            "Propose moving leads to a pipeline stage. Requires user confirmation. "
            "Use stage_id from list_stages or stage_name."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "lead_ids": {"type": "array", "items": {"type": "string"}},
                "stage_id": {"type": "string"},
                "stage_name": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["lead_ids"],
        },
    },
}

CREATE_FOLLOW_UPS_TOOL = {
    "type": "function",
    "function": {
        "name": "create_follow_ups",
        "description": (
            "Propose follow-ups for leads at a specific datetime (ISO 8601). "
            "Requires user confirmation before creating."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "lead_ids": {"type": "array", "items": {"type": "string"}},
                "scheduled_at": {
                    "type": "string",
                    "description": "ISO datetime e.g. 2026-08-21T10:00:00-04:00",
                },
                "notes": {"type": "string"},
            },
            "required": ["lead_ids", "scheduled_at"],
        },
    },
}

RANK_LEADS_TOOL = {
    "type": "function",
    "function": {
        "name": "rank_leads_to_call",
        "description": (
            "Rank which leads the user should call first (stips ready, down payment, stage). "
            "Use for 'who should I call' / priority queue questions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pool": {"type": "string", "enum": ["mine", "unassigned"]},
                "limit": {"type": "integer"},
                "has_ssn_stip": {"type": "boolean"},
                "has_dl_stip": {"type": "boolean"},
                "is_business": {"type": "boolean"},
                "down_min": {"type": "number"},
                "down_max": {"type": "number"},
            },
        },
    },
}

ALL_TOOLS = [
    SEARCH_LEADS_TOOL,
    LIST_STAGES_TOOL,
    LIST_SALESPERSONS_TOOL,
    ASSIGN_LEADS_TOOL,
    UPDATE_STAGES_TOOL,
    CREATE_FOLLOW_UPS_TOOL,
    RANK_LEADS_TOOL,
]

SYSTEM_PROMPT = """You are Tikun AI, a CRM assistant inside TikunCRM for car dealerships.

Role / access (always honor — tools already enforce this):
- bdc: can see and act on ALL leads in their accessible dealership(s). Never force pool=mine unless they ask for "my" leads. They can assign salespeople within a lead's dealership.
- dealership_admin / dealership_owner: all leads in their dealership.
- salesperson: default pool=mine; they cannot assign leads to others unless they have permission (usually they cannot).
- super_admin: all dealerships.

Rules:
- Use tools to fetch real data. Never invent leads, names, or counts.
- "SSN" / "DL" / "driver license" means stip documents on file (has_ssn_stip / has_dl_stip), not storing ID numbers.
- "Business" / "business customer" maps to is_business (trust-score Business Yes/No).
- After search_leads or rank_leads_to_call, summarize and highlight a few leads.
- For assign / stage change / follow-ups: call write tools with lead_ids from a prior search. Those only PROPOSE — user must Confirm in the UI.
- Resolve people with list_salespersons before assign when the name is ambiguous (BDC: use dealership_id when multi-store).
- Resolve stages with list_stages when needed.
- Be concise. If ambiguous, ask one clarifying question.
- For "who should I call first", use rank_leads_to_call.
"""


def _system_prompt_for_user(user: User) -> str:
    role = user.role.value if user.role else "unknown"
    extra = ""
    if user.role == UserRole.BDC:
        extra = (
            f"\nCurrent user role: bdc. "
            "Search without pool so they see all leads in accessible stores. "
            "They may filter with dealership_id when useful."
        )
    elif user.role == UserRole.SALESPERSON:
        extra = (
            f"\nCurrent user role: salesperson. "
            "Default search_leads pool=mine unless they ask for all/unassigned."
        )
    elif user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        extra = (
            f"\nCurrent user role: {role}. "
            "Search all dealership leads (omit pool) unless they ask for mine/unassigned."
        )
    else:
        extra = f"\nCurrent user role: {role}."
    return SYSTEM_PROMPT + extra


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def build_thinking_plan(user_text: str, role: str) -> str:
    """User-safe thinking summary (ChatGPT-style panel)."""
    t = user_text.lower()
    bits: List[str] = []
    if any(x in t for x in ("ssn", "social", "tax id")):
        bits.append("Map “SSN” → has_ssn_stip (document uploaded, not the number).")
    if any(x in t for x in ("dl", "license", "licence", "driver")):
        bits.append("Map “DL / license” → has_dl_stip / has_license.")
    if "business" in t:
        bits.append("Map “business” → is_business true/false.")
    m = re.search(r"(\d[\d,]*)\s*[-–to]+\s*(\d[\d,]*)", t)
    if m or "down" in t:
        bits.append("Parse down-payment range into down_min / down_max.")
    if any(x in t for x in ("assign", "give to", "hand off")):
        bits.append("This is an assign action — propose assign_leads and wait for Confirm.")
    if any(x in t for x in ("follow-up", "follow up", "remind", "call back")):
        bits.append("May need create_follow_ups after resolving datetime.")
    if any(x in t for x in ("who should i call", "call first", "priority", "rank")):
        bits.append("Use rank_leads_to_call for a prioritized queue.")
    if role == UserRole.BDC.value:
        bits.append("BDC access: search all leads in accessible dealerships (do not force pool=mine).")
    elif role == UserRole.SALESPERSON.value or "mine" in t or "my lead" in t:
        bits.append("Default pool to my assigned leads for salesperson.")
    if "unassigned" in t or "pool" in t:
        bits.append("Include unassigned pool if requested.")
    if not bits:
        bits.append("Interpret the request and call CRM tools as needed.")
    bits.append("Enforce role permissions; write tools need confirmation.")
    return " ".join(bits)


class AiAssistantService:
    @staticmethod
    def _client() -> AsyncOpenAI:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        return AsyncOpenAI(api_key=settings.openai_api_key)

    @staticmethod
    async def list_conversations(
        db: AsyncSession, user_id: UUID, limit: int = 40
    ) -> List[AiConversation]:
        res = await db.execute(
            select(AiConversation)
            .where(AiConversation.user_id == user_id)
            .order_by(AiConversation.updated_at.desc())
            .limit(limit)
        )
        return list(res.scalars().all())

    @staticmethod
    async def get_conversation(
        db: AsyncSession, conversation_id: UUID, user_id: UUID
    ) -> Optional[AiConversation]:
        res = await db.execute(
            select(AiConversation)
            .options(selectinload(AiConversation.messages))
            .where(
                AiConversation.id == conversation_id,
                AiConversation.user_id == user_id,
            )
        )
        return res.scalar_one_or_none()

    @staticmethod
    async def create_conversation(
        db: AsyncSession, user: User, title: str = "New chat"
    ) -> AiConversation:
        conv = AiConversation(
            user_id=user.id,
            dealership_id=user.dealership_id,
            title=title[:255],
        )
        db.add(conv)
        await db.flush()
        return conv

    @staticmethod
    async def delete_conversation(
        db: AsyncSession, conversation_id: UUID, user_id: UUID
    ) -> bool:
        conv = await AiAssistantService.get_conversation(db, conversation_id, user_id)
        if not conv:
            return False
        await db.delete(conv)
        await db.flush()
        return True

    @staticmethod
    async def _tool_search_leads(
        db: AsyncSession, user: User, args: dict
    ) -> Dict[str, Any]:
        from app.api.v1.endpoints.leads import _build_leads_list_select, enrich_leads_with_relations
        from app.core.access_scope import get_accessible_dealership_ids
        from sqlalchemy import func

        accessible = await get_accessible_dealership_ids(db, user)
        page_size = min(int(args.get("page_size") or 20), 50)

        # Default mine ONLY for salespeople — BDC/admin/owner see all in scope
        pool = args.get("pool")
        if pool is None and user.role == UserRole.SALESPERSON:
            pool = "mine"

        stage_id = None
        if args.get("stage_id"):
            try:
                stage_id = UUID(str(args["stage_id"]))
            except ValueError:
                stage_id = None

        dealership_id = None
        if args.get("dealership_id"):
            try:
                dealership_id = UUID(str(args["dealership_id"]))
            except ValueError:
                dealership_id = None

        source = args.get("source")
        query = _build_leads_list_select(
            user,
            accessible,
            pool=pool,
            stage_id=stage_id,
            source=source,
            search=args.get("search"),
            is_active=args.get("is_active"),
            fresh_only=args.get("fresh_only"),
            down_min=args.get("down_min"),
            down_max=args.get("down_max"),
            has_license=args.get("has_license"),
            has_ssn_stip=args.get("has_ssn_stip"),
            has_dl_stip=args.get("has_dl_stip"),
            is_business=args.get("is_business"),
            dealership_id=dealership_id,
        )

        total_q = select(func.count()).select_from(query.subquery())
        total = (await db.execute(total_q)).scalar() or 0

        query = query.order_by(Lead.created_at.desc()).limit(page_size)
        result = await db.execute(query)
        leads = list(result.scalars().all())
        enriched = await enrich_leads_with_relations(db, leads)

        filter_params = {
            k: v
            for k, v in {
                "pool": pool,
                "down_min": args.get("down_min"),
                "down_max": args.get("down_max"),
                "has_ssn_stip": args.get("has_ssn_stip"),
                "has_dl_stip": args.get("has_dl_stip"),
                "has_license": args.get("has_license"),
                "is_business": args.get("is_business"),
                "stage_id": str(stage_id) if stage_id else None,
                "dealership_id": str(dealership_id) if dealership_id else None,
                "search": args.get("search"),
                "source": source,
                "fresh_only": args.get("fresh_only"),
            }.items()
            if v is not None
        }

        rows = []
        for item in enriched[: page_size]:
            # enrich returns dicts or ORM — normalize
            if isinstance(item, dict):
                cust = item.get("customer") or {}
                name = (
                    f"{cust.get('first_name') or ''} {cust.get('last_name') or ''}".strip()
                    or "Unknown"
                )
                stage = (item.get("stage") or {}).get("name")
                rows.append(
                    {
                        "id": str(item.get("id")),
                        "name": name,
                        "down_payment": item.get("down_payment"),
                        "has_ssn_stip": item.get("has_ssn_stip"),
                        "has_dl_stip": item.get("has_dl_stip"),
                        "is_business": item.get("is_business"),
                        "stage": stage,
                        "phone": cust.get("phone"),
                    }
                )
            else:
                cust = getattr(item, "customer", None)
                name = (
                    f"{getattr(cust, 'first_name', '') or ''} {getattr(cust, 'last_name', '') or ''}".strip()
                    or "Unknown"
                )
                stage = getattr(getattr(item, "stage", None), "name", None)
                rows.append(
                    {
                        "id": str(item.id),
                        "name": name,
                        "down_payment": float(item.down_payment)
                        if item.down_payment is not None
                        else None,
                        "has_ssn_stip": bool(item.has_ssn_stip),
                        "has_dl_stip": bool(item.has_dl_stip),
                        "is_business": getattr(item, "is_business", None),
                        "stage": stage,
                        "phone": getattr(cust, "phone", None),
                    }
                )

        return {
            "total": total,
            "returned": len(rows),
            "leads": rows,
            "filter_params": filter_params,
        }

    @staticmethod
    async def _tool_list_stages(db: AsyncSession, user: User) -> Dict[str, Any]:
        from app.core.access_scope import get_accessible_dealership_ids
        from app.models.lead_stage import LeadStage

        scope = await get_accessible_dealership_ids(db, user)
        q = select(LeadStage).where(LeadStage.is_active == True)  # noqa: E712
        if scope is not None:
            # Global stages (dealership_id NULL) + stages for accessible stores
            if scope:
                q = q.where(
                    (LeadStage.dealership_id.is_(None))
                    | (LeadStage.dealership_id.in_(scope))
                )
            else:
                q = q.where(LeadStage.id.is_(None))
        q = q.order_by(LeadStage.order)
        res = await db.execute(q)
        stages = [
            {
                "id": str(s.id),
                "name": s.name,
                "display_name": s.display_name,
                "dealership_id": str(s.dealership_id) if s.dealership_id else None,
            }
            for s in res.scalars().all()
        ]
        return {"stages": stages}

    @staticmethod
    async def run_tool(
        db: AsyncSession, user: User, name: str, args: dict
    ) -> Dict[str, Any]:
        from app.services import ai_assistant_actions as actions

        if name == "search_leads":
            return await AiAssistantService._tool_search_leads(db, user, args)
        if name == "list_stages":
            return await AiAssistantService._tool_list_stages(db, user)
        if name == "list_salespersons":
            return await actions.list_salespersons(db, user, args)
        if name == "assign_leads":
            return await actions.propose_assign_leads(db, user, args)
        if name == "update_lead_stages":
            return await actions.propose_update_stages(db, user, args)
        if name == "create_follow_ups":
            return await actions.propose_follow_ups(db, user, args)
        if name == "rank_leads_to_call":
            return await actions.rank_leads_to_call(db, user, args)
        return {"error": f"Unknown tool: {name}"}

    @staticmethod
    async def confirm_actions(
        db: AsyncSession, user: User, actions_payload: List[dict]
    ) -> Dict[str, Any]:
        from app.services import ai_assistant_actions as actions

        return await actions.execute_pending_actions(db, user, actions_payload)

    @staticmethod
    async def stream_chat(
        db: AsyncSession,
        user: User,
        message: str,
        conversation_id: Optional[UUID] = None,
    ) -> AsyncIterator[str]:
        if not settings.ai_assistant_enabled:
            yield _sse("error", {"message": "Tikun AI is disabled"})
            return
        if not settings.openai_api_key:
            yield _sse("error", {"message": "OpenAI is not configured (OPENAI_API_KEY)"})
            return

        # Conversation
        if conversation_id:
            conv = await AiAssistantService.get_conversation(db, conversation_id, user.id)
            if not conv:
                yield _sse("error", {"message": "Conversation not found"})
                return
        else:
            title = (message.strip()[:60] or "New chat").replace("\n", " ")
            conv = await AiAssistantService.create_conversation(db, user, title=title)

        yield _sse("conversation", {"id": str(conv.id), "title": conv.title})

        user_msg = AiMessage(
            conversation_id=conv.id,
            role="user",
            content=message,
        )
        db.add(user_msg)
        conv.updated_at = utc_now()
        await db.flush()

        # Thinking phase
        t0 = time.monotonic()
        yield _sse("thinking_start", {})
        thinking = build_thinking_plan(message, user.role.value if user.role else "")
        # Stream thinking in chunks for UI animation
        chunk_size = 48
        for i in range(0, len(thinking), chunk_size):
            yield _sse("thinking_delta", {"text": thinking[i : i + chunk_size]})
        duration_ms = int((time.monotonic() - t0) * 1000)
        yield _sse("thinking_done", {"duration_ms": max(duration_ms, 400), "text": thinking})

        # Build chat history for OpenAI
        hist_res = await db.execute(
            select(AiMessage)
            .where(AiMessage.conversation_id == conv.id)
            .order_by(AiMessage.created_at.asc())
            .limit(40)
        )
        history = list(hist_res.scalars().all())
        oai_messages: List[dict] = [
            {"role": "system", "content": _system_prompt_for_user(user)}
        ]
        for m in history:
            if m.role in ("user", "assistant") and m.content:
                oai_messages.append({"role": m.role, "content": m.content})

        client = AiAssistantService._client()
        tools = ALL_TOOLS
        tool_traces: List[dict] = []
        ui_blocks: List[dict] = []
        pending_confirm: List[dict] = []
        assistant_text = ""

        # Tool loop (max 5 rounds)
        for _round in range(5):
            try:
                completion = await client.chat.completions.create(
                    model=settings.ai_assistant_model,
                    messages=oai_messages,
                    tools=tools,
                    tool_choice="auto",
                    temperature=0.2,
                )
            except Exception as e:
                logger.exception("OpenAI chat failed")
                yield _sse("error", {"message": str(e)})
                return

            choice = completion.choices[0]
            msg = choice.message

            if msg.tool_calls:
                oai_messages.append(
                    {
                        "role": "assistant",
                        "content": msg.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments or "{}",
                                },
                            }
                            for tc in msg.tool_calls
                        ],
                    }
                )
                for tc in msg.tool_calls:
                    name = tc.function.name
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    yield _sse(
                        "tool_start",
                        {"name": name, "args": args, "label": _tool_label(name)},
                    )
                    result = await AiAssistantService.run_tool(db, user, name, args)
                    trace = {
                        "name": name,
                        "args": args,
                        "result_summary": _summarize_tool(name, result),
                    }
                    tool_traces.append(trace)

                    # Sanitize large payloads for SSE
                    sse_result = result
                    if name == "search_leads":
                        sse_result = {
                            "total": result.get("total"),
                            "returned": result.get("returned"),
                            "leads": result.get("leads", [])[:10],
                            "filter_params": result.get("filter_params"),
                        }
                    elif name == "rank_leads_to_call":
                        sse_result = {
                            "total_considered": result.get("total_considered"),
                            "ranked": result.get("ranked", [])[:10],
                            "filter_params": result.get("filter_params"),
                        }

                    yield _sse(
                        "tool_result",
                        {
                            "name": name,
                            "summary": trace["result_summary"],
                            "result": sse_result,
                        },
                    )

                    if name == "search_leads" and result.get("leads") is not None:
                        block = {
                            "type": "lead_table",
                            "total": result.get("total"),
                            "leads": result.get("leads", [])[:10],
                            "filter_params": result.get("filter_params") or {},
                        }
                        ui_blocks.append(block)
                        yield _sse("ui_block", block)

                    if name == "rank_leads_to_call" and result.get("ranked") is not None:
                        block = {
                            "type": "ranked_leads",
                            "total": result.get("total_considered"),
                            "leads": result.get("ranked", [])[:10],
                            "filter_params": result.get("filter_params") or {},
                        }
                        ui_blocks.append(block)
                        yield _sse("ui_block", block)

                    if result.get("status") == "pending_confirmation":
                        pending_confirm.append(
                            {
                                "tool": result.get("tool") or name,
                                "summary": result.get("summary"),
                                "args": result.get("args") or {},
                            }
                        )

                    oai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": json.dumps(result, default=str)[:12000],
                        }
                    )
                continue

            # Final text
            if msg.content:
                assistant_text = msg.content
                for i in range(0, len(assistant_text), 24):
                    yield _sse("message_delta", {"text": assistant_text[i : i + 24]})
            break
        else:
            try:
                completion = await client.chat.completions.create(
                    model=settings.ai_assistant_model,
                    messages=oai_messages
                    + [
                        {
                            "role": "user",
                            "content": "Please give your final answer now based on tool results.",
                        }
                    ],
                    temperature=0.2,
                )
                assistant_text = completion.choices[0].message.content or ""
                for i in range(0, len(assistant_text), 24):
                    yield _sse("message_delta", {"text": assistant_text[i : i + 24]})
            except Exception as e:
                logger.exception("OpenAI final answer failed")
                yield _sse("error", {"message": str(e)})
                return

        if pending_confirm:
            confirm_block = {
                "type": "confirm_actions",
                "title": f"Confirm {len(pending_confirm)} action(s)",
                "actions": pending_confirm,
            }
            ui_blocks.append(confirm_block)
            yield _sse("ui_block", confirm_block)
            if not assistant_text:
                assistant_text = (
                    "I’ve prepared the action(s) below. Click Confirm to run them, "
                    "or Cancel to discard."
                )
                yield _sse("message_delta", {"text": assistant_text})

        if not assistant_text and tool_traces:
            assistant_text = "Done — see the tool results above."
            yield _sse("message_delta", {"text": assistant_text})

        asst_msg = AiMessage(
            conversation_id=conv.id,
            role="assistant",
            content=assistant_text,
            thinking=thinking,
            tool_traces=tool_traces,
            ui_blocks=ui_blocks,
        )
        db.add(asst_msg)
        conv.updated_at = utc_now()
        await db.commit()

        yield _sse(
            "done",
            {
                "conversation_id": str(conv.id),
                "message_id": str(asst_msg.id),
                "thinking": thinking,
                "tool_traces": tool_traces,
                "ui_blocks": ui_blocks,
            },
        )


def _tool_label(name: str) -> str:
    return {
        "search_leads": "Searching leads…",
        "list_stages": "Checking stages…",
        "list_salespersons": "Looking up team…",
        "assign_leads": "Preparing assignment…",
        "update_lead_stages": "Preparing stage change…",
        "create_follow_ups": "Preparing follow-ups…",
        "rank_leads_to_call": "Ranking who to call…",
    }.get(name, f"Running {name}…")


def _summarize_tool(name: str, result: dict) -> str:
    if result.get("error"):
        return str(result["error"])
    if result.get("status") == "pending_confirmation":
        return result.get("summary") or "needs confirmation"
    if name == "search_leads":
        return f"{result.get('total', 0)} leads matched"
    if name == "list_stages":
        return f"{len(result.get('stages') or [])} stages"
    if name == "list_salespersons":
        return f"{len(result.get('salespersons') or [])} people"
    if name == "rank_leads_to_call":
        return f"top {len(result.get('ranked') or [])} prioritized"
    return "done"
