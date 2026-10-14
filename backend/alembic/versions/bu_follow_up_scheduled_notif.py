"""Add FOLLOW_UP_SCHEDULED notification type

Revision ID: bu_follow_up_scheduled_notif
Revises: bt_campaign_mapping_versions
"""
from typing import Sequence, Union

from alembic import op

revision: str = "bu_follow_up_scheduled_notif"
down_revision: Union[str, None] = "bt_campaign_mapping_versions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'FOLLOW_UP_SCHEDULED'"
    )


def downgrade() -> None:
    # PostgreSQL cannot easily remove enum values
    pass
