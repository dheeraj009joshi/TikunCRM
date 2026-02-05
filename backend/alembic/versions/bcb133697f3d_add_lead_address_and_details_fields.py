"""add_lead_address_and_details_fields

Revision ID: bcb133697f3d
Revises: k8901234567h
Create Date: 2026-02-05 20:00:37.872375

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'bcb133697f3d'
down_revision: Union[str, None] = 'k8901234567h'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add address and additional detail fields to leads table
    op.add_column('leads', sa.Column('address', sa.String(length=500), nullable=True))
    op.add_column('leads', sa.Column('city', sa.String(length=100), nullable=True))
    op.add_column('leads', sa.Column('state', sa.String(length=100), nullable=True))
    op.add_column('leads', sa.Column('postal_code', sa.String(length=20), nullable=True))
    op.add_column('leads', sa.Column('country', sa.String(length=100), nullable=True))
    op.add_column('leads', sa.Column('date_of_birth', sa.DateTime(timezone=True), nullable=True))
    op.add_column('leads', sa.Column('company', sa.String(length=200), nullable=True))
    op.add_column('leads', sa.Column('job_title', sa.String(length=100), nullable=True))
    op.add_column('leads', sa.Column('preferred_contact_method', sa.String(length=50), nullable=True))
    op.add_column('leads', sa.Column('preferred_contact_time', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('leads', 'preferred_contact_time')
    op.drop_column('leads', 'preferred_contact_method')
    op.drop_column('leads', 'job_title')
    op.drop_column('leads', 'company')
    op.drop_column('leads', 'date_of_birth')
    op.drop_column('leads', 'country')
    op.drop_column('leads', 'postal_code')
    op.drop_column('leads', 'state')
    op.drop_column('leads', 'city')
    op.drop_column('leads', 'address')
