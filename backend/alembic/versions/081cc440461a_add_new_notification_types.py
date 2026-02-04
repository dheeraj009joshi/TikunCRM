"""add_new_notification_types

Revision ID: 081cc440461a
Revises: j7890123456g
Create Date: 2026-02-04 10:51:52.095447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '081cc440461a'
down_revision: Union[str, None] = 'j7890123456g'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# New notification types to add (uppercase to match existing convention)
NEW_TYPES = [
    'APPOINTMENT_REMINDER',
    'APPOINTMENT_MISSED', 
    'NEW_LEAD',
    'ADMIN_REMINDER'
]


def upgrade() -> None:
    # Add new values to the notificationtype enum
    # PostgreSQL requires executing raw ALTER TYPE statements
    for notification_type in NEW_TYPES:
        op.execute(f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{notification_type}'")


def downgrade() -> None:
    # Note: PostgreSQL doesn't support removing enum values easily
    # This would require recreating the enum type
    pass
