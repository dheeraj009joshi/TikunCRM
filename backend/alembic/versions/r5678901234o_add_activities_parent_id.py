"""Add parent_id to activities for note reply threading

Revision ID: r5678901234o
Revises: q4567890123n
Create Date: 2026-02-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'r5678901234o'
down_revision = 'q4567890123n'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'activities',
        sa.Column('parent_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        'fk_activities_parent_id_activities',
        'activities',
        'activities',
        ['parent_id'],
        ['id'],
        ondelete='CASCADE'
    )
    op.create_index(
        op.f('ix_activities_parent_id'),
        'activities',
        ['parent_id'],
        unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_activities_parent_id'), table_name='activities')
    op.drop_constraint('fk_activities_parent_id_activities', 'activities', type_='foreignkey')
    op.drop_column('activities', 'parent_id')
