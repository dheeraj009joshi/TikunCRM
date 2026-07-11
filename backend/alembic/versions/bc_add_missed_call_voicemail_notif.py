"""Add MISSED_CALL and VOICEMAIL notification types

Revision ID: bc_missed_call_voicemail_notif
Revises: bb_guest_payoff_miles
Create Date: 2026-07-12
"""
from typing import Sequence, Union

from alembic import op

revision: str = "bc_missed_call_voicemail_notif"
down_revision: Union[str, None] = "bb_guest_payoff_miles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TYPES = [
    "MISSED_CALL",
    "VOICEMAIL",
]


def upgrade() -> None:
    for notification_type in NEW_TYPES:
        op.execute(
            f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{notification_type}'"
        )


def downgrade() -> None:
    # PostgreSQL cannot easily remove enum values
    pass
