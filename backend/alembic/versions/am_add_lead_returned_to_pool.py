"""add lead returned_to_pool_at and previous_assigned_to_id

Revision ID: am_add_lead_returned_to_pool
Revises: al_add_dealership_twilio_configs
Create Date: 2026-04-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "am_add_lead_returned_to_pool"
down_revision: Union[str, None] = "al_add_dealership_twilio_configs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column(
            "returned_to_pool_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "leads",
        sa.Column(
            "previous_assigned_to_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_leads_previous_assigned_to_id_users",
        "leads",
        "users",
        ["previous_assigned_to_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_leads_returned_to_pool_at",
        "leads",
        ["returned_to_pool_at"],
        unique=False,
    )
    op.create_index(
        "ix_leads_previous_assigned_to_id",
        "leads",
        ["previous_assigned_to_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_leads_previous_assigned_to_id", table_name="leads")
    op.drop_index("ix_leads_returned_to_pool_at", table_name="leads")
    op.drop_constraint("fk_leads_previous_assigned_to_id_users", "leads", type_="foreignkey")
    op.drop_column("leads", "previous_assigned_to_id")
    op.drop_column("leads", "returned_to_pool_at")
