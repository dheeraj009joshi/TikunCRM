"""
Dealership Endpoints
"""
from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.core.security import get_password_hash
from app.db.database import get_db
from app.models.dealership import Dealership
from app.models.user import User
from app.schemas.dealership import DealershipResponse, DealershipCreate, DealershipUpdate, DealershipBrief

router = APIRouter()


@router.get("/", response_model=List[DealershipResponse])
async def list_dealerships(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_permission(Permission.VIEW_ALL_DEALERSHIPS))
) -> Any:
    """
    List all dealerships (Super Admin only).
    """
    result = await db.execute(select(Dealership))
    return result.scalars().all()


@router.post("/", response_model=DealershipResponse)
async def create_dealership(
    *,
    db: AsyncSession = Depends(get_db),
    dealership_in: DealershipCreate,
    current_user: User = Depends(deps.require_permission(Permission.CREATE_DEALERSHIP))
) -> Any:
    """
    Create new dealership with optional owner.
    
    If owner details are provided, a Dealership Owner user will be created
    and assigned to this dealership.
    """
    # Check if owner email is already registered
    if dealership_in.owner:
        result = await db.execute(select(User).where(User.email == dealership_in.owner.email))
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Owner email is already registered",
            )
    
    # Create dealership
    dealership_data = dealership_in.model_dump(exclude={"config", "working_hours", "lead_assignment_rules", "owner"})
    # Set default timezone if not provided
    if "timezone" not in dealership_data or not dealership_data.get("timezone"):
        dealership_data["timezone"] = "UTC"
    
    dealership = Dealership(
        **dealership_data,
        config=dealership_in.config,
        working_hours=dealership_in.working_hours,
        lead_assignment_rules=dealership_in.lead_assignment_rules.model_dump()
    )
    
    db.add(dealership)
    await db.flush()
    
    # Create owner user if provided
    if dealership_in.owner:
        owner = User(
            email=dealership_in.owner.email,
            password_hash=get_password_hash(dealership_in.owner.password),
            first_name=dealership_in.owner.first_name,
            last_name=dealership_in.owner.last_name,
            phone=dealership_in.owner.phone,
            role=UserRole.DEALERSHIP_OWNER,
            dealership_id=dealership.id,
            is_active=True
        )
        db.add(owner)
        await db.flush()
    
    return dealership


@router.get("/{dealership_id}", response_model=DealershipResponse)
async def get_dealership(
    dealership_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get dealership by ID.
    """
    # Permission checks
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.dealership_id != dealership_id:
             raise HTTPException(status_code=403, detail="Not authorized to view another dealership")

    result = await db.execute(select(Dealership).where(Dealership.id == dealership_id))
    dealership = result.scalar_one_or_none()
    
    if not dealership:
        raise HTTPException(status_code=404, detail="Dealership not found")
        
    return dealership


@router.put("/{dealership_id}", response_model=DealershipResponse)
async def update_dealership(
    dealership_id: UUID,
    dealership_in: DealershipUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update dealership settings.
    Dealership Owner/Admin can update their own dealership.
    Super Admin can update any dealership.
    """
    result = await db.execute(select(Dealership).where(Dealership.id == dealership_id))
    dealership = result.scalar_one_or_none()
    
    if not dealership:
        raise HTTPException(status_code=404, detail="Dealership not found")
    
    # Permission checks
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.dealership_id != dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized to update another dealership")
        if current_user.role not in [UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN]:
            raise HTTPException(status_code=403, detail="Only dealership owners and admins can update settings")
    
    # Update fields
    update_data = dealership_in.model_dump(exclude_unset=True, exclude={"config", "working_hours", "lead_assignment_rules"})
    
    for field, value in update_data.items():
        setattr(dealership, field, value)
    
    # Update nested objects if provided
    if dealership_in.config is not None:
        dealership.config = dealership_in.config
    
    if dealership_in.working_hours is not None:
        dealership.working_hours = {k: v.model_dump() if hasattr(v, 'model_dump') else v for k, v in dealership_in.working_hours.items()}
    
    if dealership_in.lead_assignment_rules is not None:
        dealership.lead_assignment_rules = dealership_in.lead_assignment_rules.model_dump()
    
    await db.flush()
    return dealership
