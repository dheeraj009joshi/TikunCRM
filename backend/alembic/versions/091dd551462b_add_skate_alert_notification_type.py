"""add_skate_alert_notification_type

Revision ID: 091dd551462b
Revises: 081cc440461a
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op


revision: str = "091dd551462b"
down_revision: Union[str, None] = "081cc440461a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'SKATE_ALERT'")


def downgrade() -> None:
    pass
