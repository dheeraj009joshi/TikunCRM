"""
Dealership Endpoints
"""
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.core.security import get_password_hash
from app.db.database import get_db
from app.models.dealership import Dealership
from app.models.user import User
from app.schemas.dealership import DealershipResponse, DealershipCreate, DealershipUpdate, DealershipBrief
from app.schemas.dealership_twilio_config import (
    DealershipTwilioConfigResponse,
    DealershipTwilioConfigUpdate,
)
from app.models.dealership_twilio_config import DealershipTwilioConfig
from app.services.dealership_twilio_config_service import get_dealership_twilio_row
from app.services.email_notifier import send_new_member_welcome_email

router = APIRouter()


def _ensure_can_manage_dealership_twilio(current_user: User, dealership_id: UUID) -> None:
    """Super Admins any dealership; owners/admins only their own."""
    if current_user.role == UserRole.SUPER_ADMIN:
        return
    if current_user.dealership_id != dealership_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to manage Twilio for this dealership",
        )
    if current_user.role not in (UserRole.DEALERSHIP_OWNER, UserRole.DEALERSHIP_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admins and dealership owners or admins can manage Twilio settings",
        )


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
    background_tasks: BackgroundTasks,
    dealership_in: DealershipCreate,
    current_user: User = Depends(deps.require_permission(Permission.CREATE_DEALERSHIP))
) -> Any:
    """
    Create new dealership with optional owner.
    
    If owner details are provided, a Dealership Owner user will be created
    and assigned to this dealership. A welcome email with login credentials
    is sent to the owner.
    """
    # Email uniqueness is dealership-scoped: the owner email may already exist in
    # other dealerships, but cannot collide with an existing super admin (they
    # share the global "no-dealership" partial unique index). Same-dealership
    # collisions are impossible here because the dealership is brand new.
    if dealership_in.owner:
        owner_email_normalized = dealership_in.owner.email.strip().lower()
        result = await db.execute(
            select(User).where(
                func.lower(User.email) == owner_email_normalized,
                User.dealership_id.is_(None),
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This email is already used by a super admin account",
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
            is_active=True,
            must_change_password=True,
        )
        db.add(owner)
        await db.flush()
        # Send welcome email with login credentials in background
        to_name = f"{owner.first_name} {owner.last_name}".strip() or owner.email
        added_by_name = current_user.full_name or current_user.email
        background_tasks.add_task(
            send_new_member_welcome_email,
            owner.email,
            to_name,
            dealership_in.owner.password,
            added_by_name,
            dealership.name,
        )

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
        # Non-super-admins cannot change is_active
        if dealership_in.is_active is not None:
            raise HTTPException(status_code=403, detail="Only Super Admins can change dealership active status")
    
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
    await db.commit()
    await db.refresh(dealership)
    return dealership


@router.patch("/{dealership_id}", response_model=DealershipResponse)
async def patch_dealership(
    dealership_id: UUID,
    dealership_in: DealershipUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Partially update dealership settings (same as PUT but explicit PATCH).
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
        # Non-super-admins cannot change is_active
        if dealership_in.is_active is not None:
            raise HTTPException(status_code=403, detail="Only Super Admins can change dealership active status")
    
    # Update only provided fields
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
    await db.commit()
    await db.refresh(dealership)
    return dealership


@router.patch("/{dealership_id}/status", response_model=DealershipResponse)
async def toggle_dealership_status(
    dealership_id: UUID,
    is_active: bool,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_super_admin),
) -> Any:
    """
    Toggle dealership active/inactive status (Super Admin only).
    """
    result = await db.execute(select(Dealership).where(Dealership.id == dealership_id))
    dealership = result.scalar_one_or_none()
    
    if not dealership:
        raise HTTPException(status_code=404, detail="Dealership not found")
    
    dealership.is_active = is_active
    await db.flush()
    await db.commit()
    await db.refresh(dealership)
    return dealership


def _twilio_config_to_response(
    dealership_id: UUID, row: Optional[DealershipTwilioConfig]
) -> DealershipTwilioConfigResponse:
    if not row:
        return DealershipTwilioConfigResponse(
            dealership_id=dealership_id,
            auth_token_set=False,
            api_key_secret_set=False,
        )
    auth_plain = row.auth_token
    sec_plain = row.twilio_api_key_secret
    return DealershipTwilioConfigResponse(
        dealership_id=dealership_id,
        account_sid=row.account_sid,
        auth_token_set=bool(auth_plain),
        auth_token=auth_plain or None,
        sms_enabled=row.sms_enabled,
        sms_from_number=row.sms_from_number,
        whatsapp_enabled=row.whatsapp_enabled,
        whatsapp_from_number=row.whatsapp_from_number,
        voice_enabled=row.voice_enabled,
        twilio_twiml_app_sid=row.twilio_twiml_app_sid,
        twilio_api_key_sid=row.twilio_api_key_sid,
        api_key_secret_set=bool(sec_plain),
        twilio_api_key_secret=sec_plain or None,
        voice_caller_id_number=row.voice_caller_id_number,
        ai_outbound_enabled=row.ai_outbound_enabled,
    )


@router.get(
    "/{dealership_id}/twilio-config",
    response_model=DealershipTwilioConfigResponse,
)
async def get_dealership_twilio_config(
    dealership_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_config_unlock),
) -> Any:
    """Read per-dealership Twilio settings. Decrypted auth token and API key secret are included after config unlock."""
    _ensure_can_manage_dealership_twilio(current_user, dealership_id)
    result = await db.execute(select(Dealership).where(Dealership.id == dealership_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dealership not found")
    row = await get_dealership_twilio_row(db, dealership_id)
    return _twilio_config_to_response(dealership_id, row)


@router.patch(
    "/{dealership_id}/twilio-config",
    response_model=DealershipTwilioConfigResponse,
)
async def patch_dealership_twilio_config(
    dealership_id: UUID,
    body: DealershipTwilioConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_config_unlock),
) -> Any:
    """Create or update Twilio credentials (secrets stored encrypted at rest)."""
    _ensure_can_manage_dealership_twilio(current_user, dealership_id)
    result = await db.execute(select(Dealership).where(Dealership.id == dealership_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dealership not found")

    row = await get_dealership_twilio_row(db, dealership_id)
    if not row:
        row = DealershipTwilioConfig(dealership_id=dealership_id)
        db.add(row)

    data = body.model_dump(exclude_unset=True)
    if "auth_token" in data:
        token = data.pop("auth_token")
        if token and str(token).strip():
            row.auth_token = str(token).strip()
    if "twilio_api_key_secret" in data:
        sec = data.pop("twilio_api_key_secret")
        if sec and str(sec).strip():
            row.twilio_api_key_secret = str(sec).strip()

    for key in (
        "account_sid",
        "sms_enabled",
        "sms_from_number",
        "whatsapp_enabled",
        "whatsapp_from_number",
        "voice_enabled",
        "twilio_twiml_app_sid",
        "twilio_api_key_sid",
        "voice_caller_id_number",
        "ai_outbound_enabled",
    ):
        if key in data:
            setattr(row, key, data[key])

    row.updated_by_user_id = current_user.id
    await db.flush()
    await db.commit()
    await db.refresh(row)
    return _twilio_config_to_response(dealership_id, row)
