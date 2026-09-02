"""
Access scoping for single-org Carvaminos model.

All users belong to the same organization. Scoping is now role-based only:
  - SUPER_ADMIN / DEALERSHIP_ADMIN: see all leads
  - BDC: see all leads (was multi-store, now single-org)
  - SALESPERSON: see only assigned leads (+ unassigned in their org)
"""
from typing import Any, Dict, FrozenSet, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole
from app.models.dealership import Dealership
from app.models.user import User

ORG_WIDE_ROLES: FrozenSet[UserRole] = frozenset({
    UserRole.SUPER_ADMIN,
    UserRole.DEALERSHIP_ADMIN,
    UserRole.DEALERSHIP_OWNER,
    UserRole.BDC,
})


def is_org_wide_role(user: User) -> bool:
    """True for roles that see the entire Carvaminos organization."""
    return user.role in ORG_WIDE_ROLES


async def get_carvaminos_dealership_id(db: AsyncSession) -> Optional[UUID]:
    """Return the active Carvaminos org dealership id, if present."""
    result = await db.execute(
        select(Dealership.id).where(
            Dealership.slug == "carvaminos",
            Dealership.is_active.is_(True),
        ).limit(1)
    )
    row = result.scalar_one_or_none()
    return row


async def resolve_user_dealership_id(db: AsyncSession, user: User) -> Optional[UUID]:
    """
    Effective org dealership for settings/team filters.
    Uses user.dealership_id when set; org-wide roles fall back to Carvaminos.
    """
    if user.dealership_id is not None:
        return user.dealership_id
    if is_org_wide_role(user):
        return await get_carvaminos_dealership_id(db)
    return None


async def build_ws_token_claims(db: AsyncSession, user: User) -> Dict[str, Any]:
    """JWT claims for WebSocket channel subscriptions."""
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    claims: Dict[str, Any] = {"role": role}
    org_id = await resolve_user_dealership_id(db, user)
    if org_id:
        claims["dealership_id"] = str(org_id)
    return claims


async def get_accessible_dealership_ids(
    db: AsyncSession,
    user: User,
) -> Optional[List[UUID]]:
    """
    Return dealership IDs the user may access.

    Single-org model: everyone accesses the same Carvaminos dealership.
    Returns None (= no filter) for admin/manager/BDC roles,
    or [user.dealership_id] for salesperson.
    """
    if is_org_wide_role(user):
        return None

    org_id = await resolve_user_dealership_id(db, user)
    if org_id is not None:
        return [org_id]

    return []


async def user_can_access_dealership(
    db: AsyncSession,
    user: User,
    dealership_id: Optional[UUID],
) -> bool:
    """Check if user can access a specific dealership (always true in single-org)."""
    if is_org_wide_role(user):
        return True

    if dealership_id is None:
        return False

    org_id = await resolve_user_dealership_id(db, user)
    return org_id == dealership_id


def apply_dealership_scope_to_lead_query(query, accessible_ids: Optional[List[UUID]], lead_model):
    """
    Apply dealership filter to a Lead SELECT query.
    accessible_ids=None means no filter (admin / manager / BDC).
    """
    if accessible_ids is None:
        return query
    if not accessible_ids:
        return query.where(lead_model.id.is_(None))
    return query.where(lead_model.dealership_id.in_(accessible_ids))


def apply_dealership_scope_to_query(query, accessible_ids: Optional[List[UUID]], dealership_id_column):
    """Apply dealership filter using an arbitrary dealership_id column."""
    if accessible_ids is None:
        return query
    if not accessible_ids:
        return query.where(dealership_id_column.in_([]))
    return query.where(dealership_id_column.in_(accessible_ids))


async def user_can_access_lead(
    db: AsyncSession,
    user: User,
    lead_dealership_id: Optional[UUID],
    lead_assigned_to: Optional[UUID] = None,
) -> bool:
    """Check if user may view/act on a lead."""
    if is_org_wide_role(user):
        return True

    if user.role == UserRole.SALESPERSON:
        org_id = await resolve_user_dealership_id(db, user)
        return (
            lead_assigned_to == user.id
            or lead_dealership_id == org_id
        )

    return False
