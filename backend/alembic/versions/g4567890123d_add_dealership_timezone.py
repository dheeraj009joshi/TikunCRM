"""Add timezone to dealerships

Revision ID: g4567890123d
Revises: f3456789012c
Create Date: 2026-01-28 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g4567890123d'
down_revision = 'f3456789012c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add timezone column to dealerships table
    op.add_column('dealerships', 
        sa.Column('timezone', sa.String(length=100), nullable=False, server_default='UTC')
    )


def downgrade() -> None:
    # Remove timezone column
    op.drop_column('dealerships', 'timezone')
