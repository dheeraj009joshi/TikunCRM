"""
User Endpoints
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead
from app.models.dealership import Dealership
from app.models.user_dealership_access import UserDealershipAccess
from app.schemas.user import (
    UserResponse,
    UserCreate,
    UserUpdate,
    UserBrief,
    UserWithStats,
    TeamListResponse,
    SetConfigAccessPasswordRequest,
    DealershipAccessItem,
    UserDealershipAccessResponse,
    UserDealershipAccessUpdate,
)
from app.core.security import get_password_hash, verify_password
from app.services.email_notifier import send_new_member_welcome_email

router = APIRouter()


@router.get("/", response_model=List[UserBrief])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    dealership_id: Optional[UUID] = None,
    role: Optional[UserRole] = None,
    is_active: Optional[bool] = None
) -> Any:
    """
    List users with optional filters.
    Super Admin sees all, Dealership Admin sees their team.
    """
    query = select(User)
    
    # Role-based filtering
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        query = query.where(User.dealership_id == current_user.dealership_id)
    elif current_user.role == UserRole.BDC:
        query = query.where(User.id == current_user.id)
    elif current_user.role == UserRole.SALESPERSON:
        # Salesperson can only see themselves
        query = query.where(User.id == current_user.id)
    elif dealership_id:
        # Super Admin can filter by dealership
        query = query.where(User.dealership_id == dealership_id)
    
    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    
    query = query.order_by(User.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/mentionable", response_model=List[UserBrief])
async def get_mentionable_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    dealership_id: Optional[UUID] = None
) -> Any:
    """
    Get users that can be mentioned in notes.
    - Dealership users: Can mention users in the same dealership
    - Super Admin: Can mention users in a specific dealership or all users
    
    Returns active users only.
    """
    query = select(User).where(User.is_active == True)
    
    # Determine which users can be mentioned
    if current_user.role == UserRole.SUPER_ADMIN:
        if dealership_id:
            query = query.where(User.dealership_id == dealership_id)
    elif current_user.role == UserRole.BDC:
        from app.core.access_scope import get_accessible_dealership_ids
        accessible_ids = await get_accessible_dealership_ids(db, current_user)
        if dealership_id:
            if accessible_ids and dealership_id not in accessible_ids:
                return []
            query = query.where(User.dealership_id == dealership_id)
        elif accessible_ids:
            query = query.where(User.dealership_id.in_(accessible_ids))
        else:
            return []
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER, UserRole.SALESPERSON]:
        # Dealership users can only mention users in their dealership
        if current_user.dealership_id:
            query = query.where(User.dealership_id == current_user.dealership_id)
        else:
            # No dealership - can't mention anyone
            return []
    
    # Exclude current user from the list (can't mention yourself)
    query = query.where(User.id != current_user.id)
    
    # Order by name
    query = query.order_by(User.first_name, User.last_name)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/team", response_model=TeamListResponse)
async def get_team_with_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    dealership_id: Optional[UUID] = None
) -> Any:
    """
    Get team members with their lead statistics.
    For Dealership Admin to view team performance.
    """
    # Determine which dealership to fetch
    target_dealership_id = dealership_id
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        target_dealership_id = current_user.dealership_id
    elif current_user.role == UserRole.SALESPERSON:
        raise HTTPException(status_code=403, detail="Salespersons cannot view team stats")
    
    if not target_dealership_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Dealership ID required")
    
    # Get dealership info
    dealership_name = None
    if target_dealership_id:
        dealership_result = await db.execute(
            select(Dealership).where(Dealership.id == target_dealership_id)
        )
        dealership = dealership_result.scalar_one_or_none()
        if dealership:
            dealership_name = dealership.name
    
    # Get team members (include inactive so admin/owner can see and reactivate them)
    query = select(User).where(
        User.role.in_([UserRole.SALESPERSON, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER])
    )
    if target_dealership_id:
        query = query.where(User.dealership_id == target_dealership_id)
    
    result = await db.execute(query)
    users = result.scalars().all()
    
    # Build stats for each user
    team_members = []
    for user in users:
        # Get lead counts
        total_leads_result = await db.execute(
            select(func.count(Lead.id)).where(Lead.assigned_to == user.id)
        )
        total_leads = total_leads_result.scalar() or 0
        
        active_leads_result = await db.execute(
            select(func.count(Lead.id)).where(
                and_(
                    Lead.assigned_to == user.id,
                    Lead.is_active == True
                )
            )
        )
        active_leads = active_leads_result.scalar() or 0
        
        converted_leads_result = await db.execute(
            select(func.count(Lead.id)).where(
                and_(
                    Lead.assigned_to == user.id,
                    Lead.outcome == "converted"
                )
            )
        )
        converted_leads = converted_leads_result.scalar() or 0
        
        conversion_rate = (converted_leads / total_leads * 100) if total_leads > 0 else 0.0
        
        team_members.append(UserWithStats(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            role=user.role,
            is_active=user.is_active,
            dealership_id=user.dealership_id,
            total_leads=total_leads,
            active_leads=active_leads,
            converted_leads=converted_leads,
            conversion_rate=round(conversion_rate, 1)
        ))
    
    return TeamListResponse(
        items=team_members,
        total=len(team_members),
        dealership_id=target_dealership_id,
        dealership_name=dealership_name
    )


@router.get("/salespersons", response_model=List[UserBrief])
async def list_salespersons(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    dealership_id: Optional[UUID] = None
) -> Any:
    """
    Get list of team members for lead assignment dropdown.
    Includes salespersons, dealership admins, and dealership owners (who can also be assigned leads).
    """
    query = select(User).where(
        and_(
            User.role.in_([UserRole.SALESPERSON, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]),
            User.is_active == True
        )
    )
    
    # Filter by dealership
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        query = query.where(User.dealership_id == current_user.dealership_id)
    elif current_user.role == UserRole.BDC:
        if not dealership_id:
            raise HTTPException(
                status_code=400,
                detail="dealership_id query param is required for BDC users",
            )
        from app.core.access_scope import user_can_access_dealership
        if not await user_can_access_dealership(db, current_user, dealership_id):
            raise HTTPException(status_code=403, detail="Not authorized for this dealership")
        query = query.where(User.dealership_id == dealership_id)
    elif dealership_id:
        query = query.where(User.dealership_id == dealership_id)
    
    query = query.order_by(User.role, User.first_name)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=UserResponse)
async def create_user(
    *,
    db: AsyncSession = Depends(get_db),
    background_tasks: BackgroundTasks,
    user_in: UserCreate,
    current_user: User = Depends(deps.require_permission(Permission.CREATE_USER))
) -> Any:
    """
    Create new user.
    
    Sends a welcome email to the new user with their temporary login credentials.
    User is required to change password on first login.
    
    Role creation restrictions:
    - Super Admin: can create any role
    - Dealership Owner: can create Dealership Admin and Salesperson (within their dealership)
    - Dealership Admin: can only create Salesperson (within their dealership)
    """
    # Email uniqueness is dealership-scoped: the same email may be reused in
    # different dealerships, but must be unique within a single dealership.
    # Super admins (no dealership) must still be globally unique among themselves.
    email_normalized = user_in.email.strip().lower()
    if user_in.dealership_id is None:
        # Super admin / BDC (no dealership); unique among null-dealership accounts.
        dup_query = select(User).where(
            func.lower(User.email) == email_normalized,
            User.dealership_id.is_(None),
        )
        dup_msg = "This email is already used by another platform-level account"
    else:
        dup_query = select(User).where(
            func.lower(User.email) == email_normalized,
            User.dealership_id == user_in.dealership_id,
        )
        dup_msg = "Email already registered in this dealership"

    result = await db.execute(dup_query)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=dup_msg,
        )
    
    # Role creation restrictions based on current user's role
    if current_user.role == UserRole.DEALERSHIP_ADMIN:
        # Dealership Admin can only create Salespersons
        if user_in.role != UserRole.SALESPERSON:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Dealership Admins can only add Salespersons",
            )
        # Force same dealership
        user_in.dealership_id = current_user.dealership_id
    
    elif current_user.role == UserRole.DEALERSHIP_OWNER:
        # Dealership Owner can create Dealership Admin and Salesperson
        if user_in.role not in (UserRole.DEALERSHIP_ADMIN, UserRole.SALESPERSON):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Dealership Owners can only add Dealership Admins and Salespersons",
            )
        # Force same dealership
        user_in.dealership_id = current_user.dealership_id
    
    elif current_user.role != UserRole.SUPER_ADMIN:
        # Any other role shouldn't be creating users
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to create users",
        )
    
    # BDC: platform-level user, dealerships assigned separately
    if user_in.role == UserRole.BDC:
        if current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Super Admin can create BDC agents",
            )
        user_in.dealership_id = None

    # Validate dealership for dealership-scoped roles
    if user_in.role not in (UserRole.SUPER_ADMIN, UserRole.BDC) and not user_in.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dealership ID is required for this role",
        )

    if user_in.role == UserRole.SUPER_ADMIN:
        user_in.dealership_id = None

    phone_val = (user_in.phone or "").strip() or None

    user = User(
        email=user_in.email,
        password_hash=get_password_hash(user_in.password),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        phone=phone_val,
        role=user_in.role,
        dealership_id=user_in.dealership_id,
        is_active=True,
        must_change_password=True  # Force password change on first login
    )
    
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        raw = str(getattr(exc, "orig", exc) or exc).lower()
        if "ix_users_email_per_dealership" in raw or "lower(email), dealership_id" in raw:
            detail = "This email is already registered for this dealership."
        elif "ix_users_email_super_admin" in raw:
            detail = "This email is already used by a super admin account."
        elif "unique" in raw or "duplicate" in raw:
            detail = "This record conflicts with a uniqueness rule in the database."
        else:
            detail = "Could not create this user (database constraint). Check email and dealership."
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from None

    # Send welcome email with login credentials in background (after response, session will have committed)
    to_name = f"{user.first_name} {user.last_name}".strip() or user.email
    added_by_name = current_user.full_name or current_user.email
    dealership_name: str | None = None
    if user.dealership_id:
        dealership_row = await db.execute(
            select(Dealership.name).where(Dealership.id == user.dealership_id)
        )
        dealership_name = dealership_row.scalar_one_or_none()
    background_tasks.add_task(
        send_new_member_welcome_email,
        user.email,
        to_name,
        user_in.password,
        added_by_name,
        dealership_name,
    )

    return user


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get current user's profile.
    """
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_current_user_profile(
    user_update: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update current user's profile.
    Users can update their own name, phone, and dealership email.
    """
    update_data = user_update.model_dump(exclude_unset=True)
    
    # Users cannot change their own is_active status
    update_data.pop("is_active", None)
    
    for field, value in update_data.items():
        setattr(current_user, field, value)
    
    await db.commit()
    await db.refresh(current_user)
    
    return current_user


_CONFIG_ACCESS_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.DEALERSHIP_OWNER,
    UserRole.DEALERSHIP_ADMIN,
)


@router.put("/me/config-access-password", response_model=UserResponse)
async def set_config_access_password(
    body: SetConfigAccessPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Any:
    """
    Set or change the configuration-access password (used with /auth/verify-config-access).
    Must differ from your CRM login password.
    """
    if current_user.role not in _CONFIG_ACCESS_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role cannot set a configuration-access password",
        )
    if not verify_password(body.login_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Login password is incorrect",
        )
    if body.config_password != body.config_password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuration passwords do not match",
        )
    if body.config_password == body.login_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuration-access password must differ from your login password",
        )
    if verify_password(body.config_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuration-access password must differ from your login password",
        )
    if current_user.config_access_password_hash:
        if not body.current_config_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current configuration password is required to change it",
            )
        if not verify_password(body.current_config_password, current_user.config_access_password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current configuration password is incorrect",
            )

    current_user.config_access_password_hash = get_password_hash(body.config_password)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    user_update: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update a user by ID.
    Only Super Admin, Dealership Admin, or Dealership Owner can update users.
    Super Admin, Dealership Admin, or Dealership Owner can change is_active (deactivate/activate team members).
    Users cannot deactivate themselves.
    """
    # Only admin or owner can update other users
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators or dealership owners can update team members",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Dealership isolation: admin/owner can only update users in their dealership
    if current_user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        if user.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized to update this user")

    update_data = user_update.model_dump(exclude_unset=True)

    # Super Admin, Dealership Admin, or Dealership Owner can change is_active (deactivate/activate)
    if "is_active" in update_data:
        if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators or dealership owners can deactivate or activate team members",
            )
        if current_user.id == user_id:
            # Cannot deactivate yourself
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot deactivate your own account",
            )
        setattr(user, "is_active", update_data["is_active"])
        update_data.pop("is_active")

    if "role" in update_data:
        new_role = update_data["role"]
        if current_user.id == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot change your own role",
            )
        if current_user.role == UserRole.DEALERSHIP_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Dealership Admins cannot change team member roles",
            )
        if current_user.role == UserRole.DEALERSHIP_OWNER:
            if new_role not in (UserRole.DEALERSHIP_ADMIN, UserRole.SALESPERSON):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Dealership Owners can only assign Admin or Salesperson roles",
                )
        elif current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to change roles",
            )
        user.role = new_role
        update_data.pop("role")

    # Apply other allowed fields (name, phone, etc.)
    for field, value in update_data.items():
        if hasattr(user, field):
            setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return user


@router.get("/bdc-agents", response_model=List[UserBrief])
async def list_bdc_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.SUPER_ADMIN)),
) -> Any:
    """List all BDC agents (Super Admin only)."""
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.BDC, User.is_active == True)
        .order_by(User.first_name, User.last_name)
    )
    return result.scalars().all()


@router.get("/{user_id}/dealership-access", response_model=UserDealershipAccessResponse)
async def get_user_dealership_access(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.SUPER_ADMIN)),
) -> Any:
    """List dealerships assigned to a BDC user (Super Admin only)."""
    user_result = await db.execute(select(User).where(User.id == user_id))
    target = user_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role != UserRole.BDC:
        raise HTTPException(status_code=400, detail="User is not a BDC agent")

    rows = await db.execute(
        select(Dealership.id, Dealership.name)
        .join(UserDealershipAccess, UserDealershipAccess.dealership_id == Dealership.id)
        .where(UserDealershipAccess.user_id == user_id)
        .order_by(Dealership.name)
    )
    dealerships = [
        DealershipAccessItem(id=row[0], name=row[1]) for row in rows.fetchall()
    ]
    return UserDealershipAccessResponse(user_id=user_id, dealerships=dealerships)


@router.put("/{user_id}/dealership-access", response_model=UserDealershipAccessResponse)
async def set_user_dealership_access(
    user_id: UUID,
    body: UserDealershipAccessUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_role(UserRole.SUPER_ADMIN)),
) -> Any:
    """Replace dealerships assigned to a BDC user (Super Admin only)."""
    user_result = await db.execute(select(User).where(User.id == user_id))
    target = user_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role != UserRole.BDC:
        raise HTTPException(status_code=400, detail="User is not a BDC agent")

    if body.dealership_ids:
        d_result = await db.execute(
            select(Dealership.id).where(
                Dealership.id.in_(body.dealership_ids),
                Dealership.is_active == True,
            )
        )
        found = set(d_result.scalars().all())
        missing = set(body.dealership_ids) - found
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid or inactive dealership IDs: {', '.join(str(m) for m in missing)}",
            )

    await db.execute(
        delete(UserDealershipAccess).where(UserDealershipAccess.user_id == user_id)
    )
    for did in body.dealership_ids:
        db.add(
            UserDealershipAccess(
                user_id=user_id,
                dealership_id=did,
                assigned_by=current_user.id,
            )
        )
    await db.commit()

    rows = await db.execute(
        select(Dealership.id, Dealership.name)
        .join(UserDealershipAccess, UserDealershipAccess.dealership_id == Dealership.id)
        .where(UserDealershipAccess.user_id == user_id)
        .order_by(Dealership.name)
    )
    dealerships = [
        DealershipAccessItem(id=row[0], name=row[1]) for row in rows.fetchall()
    ]
    return UserDealershipAccessResponse(user_id=user_id, dealerships=dealerships)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get user by ID.
    """
    # Authorization checks
    if current_user.role == UserRole.SALESPERSON and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if current_user.role == UserRole.BDC and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Dealership isolation check
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if user.dealership_id != current_user.dealership_id:
             raise HTTPException(status_code=403, detail="Not authorized")

    return user
