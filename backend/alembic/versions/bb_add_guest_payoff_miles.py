"""Add payoff, payoff_bank, and miles to guests

Revision ID: bb_guest_payoff_miles
Revises: ba_tasks
Create Date: 2026-07-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "bb_guest_payoff_miles"
down_revision: Union[str, None] = "ba_tasks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("guests", sa.Column("payoff", sa.Numeric(12, 2), nullable=True))
    op.add_column("guests", sa.Column("payoff_bank", sa.String(255), nullable=True))
    op.add_column("guests", sa.Column("miles", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("guests", "miles")
    op.drop_column("guests", "payoff_bank")
    op.drop_column("guests", "payoff")
