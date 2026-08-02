"""
Timezone utilities for dealership-based timezone handling
"""
from datetime import datetime
from typing import Optional
import pytz
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.dealership import Dealership
from app.models.user import User

# Matches frontend DEFAULT_TIMEZONE — used only when dealership has no timezone string
DEFAULT_DEALERSHIP_TIMEZONE = "America/New_York"


def resolve_dealership_timezone(timezone_name: Optional[str]) -> str:
    """Use dealership.timezone as-is (including UTC). Fallback only when blank."""
    if not timezone_name or not str(timezone_name).strip():
        return DEFAULT_DEALERSHIP_TIMEZONE
    return str(timezone_name).strip()


def format_appointment_label(dt: Optional[datetime], timezone_name: Optional[str]) -> Optional[str]:
    """Human appointment label in dealership TZ, e.g. 'Saturday - Jul 18, 2026 - 3:00 PM'."""
    if not dt:
        return None
    tz = resolve_dealership_timezone(timezone_name)
    local = convert_to_timezone(dt, tz)
    hour12 = local.hour % 12 or 12
    return (
        f"{local.strftime('%A')} - {local.strftime('%b')} {local.day}, {local.year} "
        f"- {hour12}:{local.strftime('%M %p')}"
    )


async def get_dealership_timezone(db: AsyncSession, dealership_id: Optional[str]) -> str:
    """
    Get timezone for a dealership.
    Returns 'UTC' if dealership not found or no timezone set.
    """
    if not dealership_id:
        return "UTC"
    
    try:
        result = await db.execute(
            select(Dealership.timezone).where(Dealership.id == dealership_id)
        )
        timezone = result.scalar_one_or_none()
        return timezone if timezone else "UTC"
    except Exception:
        return "UTC"


async def get_user_dealership_timezone(db: AsyncSession, user: User) -> str:
    """
    Get timezone for a user's dealership.
    Returns 'UTC' if user has no dealership or dealership not found.
    """
    return await get_dealership_timezone(db, str(user.dealership_id) if user.dealership_id else None)


def convert_to_timezone(dt: datetime, timezone_name: str) -> datetime:
    """
    Convert a datetime to a specific timezone.
    
    Args:
        dt: Datetime object (assumed to be UTC if naive)
        timezone_name: IANA timezone name (e.g., 'America/New_York')
    
    Returns:
        Datetime in the specified timezone
    """
    if dt.tzinfo is None:
        # Assume UTC if naive
        dt = pytz.UTC.localize(dt)
    
    target_tz = pytz.timezone(timezone_name)
    return dt.astimezone(target_tz)


def format_datetime_in_timezone(dt: datetime, timezone_name: str, format_str: str = "%Y-%m-%d %H:%M:%S %Z") -> str:
    """
    Format a datetime in a specific timezone.
    
    Args:
        dt: Datetime object
        timezone_name: IANA timezone name
        format_str: Format string for datetime
    
    Returns:
        Formatted datetime string
    """
    converted_dt = convert_to_timezone(dt, timezone_name)
    return converted_dt.strftime(format_str)
