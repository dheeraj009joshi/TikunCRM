"""add user config_access_password_hash

Revision ID: an_add_user_config_access_password
Revises: am_add_lead_returned_to_pool
Create Date: 2026-04-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "an_add_user_config_access_password"
down_revision: Union[str, None] = "am_add_lead_returned_to_pool"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "config_access_password_hash",
            sa.String(length=255),
            nullable=True,
            comment="Bcrypt hash; used with X-Config-Unlock-Token after POST /auth/verify-config-access",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "config_access_password_hash")
