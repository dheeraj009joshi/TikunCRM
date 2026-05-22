"""
Dealership access scoping for multi-store BDC and other roles.
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole
from app.models.user import User
from app.models.user_dealership_access import UserDealershipAccess


async def build_ws_token_claims(db: AsyncSession, user: User) -> Dict[str, Any]:
    """
    JWT claims used by the WebSocket endpoint to subscribe users to the right
    dealership broadcast channels (especially BDC multi-store access).
    """
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    claims: Dict[str, Any] = {"role": role}
    if user.dealership_id:
        claims["dealership_id"] = str(user.dealership_id)
    if user.role == UserRole.BDC:
        ids = await get_accessible_dealership_ids(db, user)
        if ids:
            claims["accessible_dealership_ids"] = [str(i) for i in ids]
    return claims


async def get_accessible_dealership_ids(
    db: AsyncSession,
    user: User,
) -> Optional[List[UUID]]:
    """
    Return dealership IDs the user may access.

    - None: all dealerships (super_admin)
    - []: no dealership access
    - [uuid, ...]: explicit scope (bdc via junction, single store for dealership roles)
    """
    if user.role == UserRole.SUPER_ADMIN:
        return None

    if user.role == UserRole.BDC:
        result = await db.execute(
            select(UserDealershipAccess.dealership_id).where(
                UserDealershipAccess.user_id == user.id
            )
        )
        return list(result.scalars().all())

    if user.dealership_id is not None:
        return [user.dealership_id]

    return []


async def user_can_access_dealership(
    db: AsyncSession,
    user: User,
    dealership_id: Optional[UUID],
) -> bool:
    """Check if user can access a specific dealership."""
    if dealership_id is None:
        return user.role == UserRole.SUPER_ADMIN

    accessible = await get_accessible_dealership_ids(db, user)
    if accessible is None:
        return True
    return dealership_id in accessible


def apply_dealership_scope_to_lead_query(query, accessible_ids: Optional[List[UUID]], lead_model):
    """
    Apply dealership filter to a Lead SELECT query.
    accessible_ids=None means no filter (super admin).
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
    if lead_dealership_id is None:
        return user.role == UserRole.SUPER_ADMIN

    accessible = await get_accessible_dealership_ids(db, user)
    if accessible is not None and lead_dealership_id not in accessible:
        return False

    if user.role == UserRole.SALESPERSON:
        return (
            lead_assigned_to == user.id
            or lead_dealership_id == user.dealership_id
        )

    if user.role in (
        UserRole.SUPER_ADMIN,
        UserRole.DEALERSHIP_ADMIN,
        UserRole.DEALERSHIP_OWNER,
        UserRole.BDC,
    ):
        return True

    return False
