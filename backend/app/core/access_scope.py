"""
Access scoping for single-org Carvaminos model.

All users belong to the same organization. Scoping is now role-based only:
  - SUPER_ADMIN / DEALERSHIP_ADMIN: see all leads
  - BDC: see all leads (was multi-store, now single-org)
  - SALESPERSON: see only assigned leads (+ unassigned in their org)
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole
from app.models.user import User
from app.models.user_dealership_access import UserDealershipAccess


async def build_ws_token_claims(db: AsyncSession, user: User) -> Dict[str, Any]:
    """JWT claims for WebSocket channel subscriptions."""
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    claims: Dict[str, Any] = {"role": role}
    if user.dealership_id:
        claims["dealership_id"] = str(user.dealership_id)
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
    if user.role in (
        UserRole.SUPER_ADMIN,
        UserRole.DEALERSHIP_ADMIN,
        UserRole.DEALERSHIP_OWNER,
        UserRole.BDC,
    ):
        return None

    if user.dealership_id is not None:
        return [user.dealership_id]

    return []


async def user_can_access_dealership(
    db: AsyncSession,
    user: User,
    dealership_id: Optional[UUID],
) -> bool:
    """Check if user can access a specific dealership (always true in single-org)."""
    if user.role in (
        UserRole.SUPER_ADMIN,
        UserRole.DEALERSHIP_ADMIN,
        UserRole.DEALERSHIP_OWNER,
        UserRole.BDC,
    ):
        return True

    if dealership_id is None:
        return False

    return user.dealership_id == dealership_id


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
    return query.where(dealership_id_column.in_(accessible_ids))


async def user_can_access_lead(
    db: AsyncSession,
    user: User,
    lead_dealership_id: Optional[UUID],
    lead_assigned_to: Optional[UUID] = None,
) -> bool:
    """Check if user may view/act on a lead."""
    if user.role in (
        UserRole.SUPER_ADMIN,
        UserRole.DEALERSHIP_ADMIN,
        UserRole.DEALERSHIP_OWNER,
        UserRole.BDC,
    ):
        return True

    if user.role == UserRole.SALESPERSON:
        return (
            lead_assigned_to == user.id
            or lead_dealership_id == user.dealership_id
        )

    return False
