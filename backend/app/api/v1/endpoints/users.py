"""
User Endpoints
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead, LeadStatus
from app.models.dealership import Dealership
from app.schemas.user import UserResponse, UserCreate, UserUpdate, UserBrief, UserWithStats, TeamListResponse
from app.core.security import get_password_hash
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
        # Super Admin can mention anyone, optionally filter by dealership
        if dealership_id:
            query = query.where(User.dealership_id == dealership_id)
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
    
    # Get team members
    query = select(User).where(
        and_(
            User.role.in_([UserRole.SALESPERSON, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]),
            User.is_active == True
        )
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
                    Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.FOLLOW_UP, LeadStatus.INTERESTED])
                )
            )
        )
        active_leads = active_leads_result.scalar() or 0
        
        converted_leads_result = await db.execute(
            select(func.count(Lead.id)).where(
                and_(
                    Lead.assigned_to == user.id,
                    Lead.status == LeadStatus.CONVERTED
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
    # Check email uniqueness
    result = await db.execute(select(User).where(User.email == user_in.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
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
    
    # Validate dealership for non-superadmin roles
    if user_in.role not in (UserRole.SUPER_ADMIN,) and not user_in.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dealership ID is required for this role",
        )

    user = User(
        email=user_in.email,
        password_hash=get_password_hash(user_in.password),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        role=user_in.role,
        dealership_id=user_in.dealership_id,
        is_active=True,
        must_change_password=True  # Force password change on first login
    )
    
    db.add(user)
    await db.flush()

    # Send welcome email with login credentials in background (after response, session will have committed)
    to_name = f"{user.first_name} {user.last_name}".strip() or user.email
    added_by_name = current_user.full_name or current_user.email
    background_tasks.add_task(
        send_new_member_welcome_email,
        user.email,
        to_name,
        user_in.password,
        added_by_name,
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
        
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Dealership isolation check
    if current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if user.dealership_id != current_user.dealership_id:
             raise HTTPException(status_code=403, detail="Not authorized")

    return user
