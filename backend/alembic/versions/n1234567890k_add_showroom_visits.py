"""Add showroom_visits table for check-in/check-out tracking

Revision ID: n1234567890k
Revises: m0123456789j
Create Date: 2026-01-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'n1234567890k'
down_revision = 'm0123456789j'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create ShowroomOutcome enum
    showroom_outcome_enum = postgresql.ENUM(
        'sold', 'not_interested', 'follow_up', 'reschedule', 'browsing',
        name='showroomoutcome', create_type=False
    )
    showroom_outcome_enum.create(op.get_bind(), checkfirst=True)
    
    # Create showroom_visits table
    op.create_table(
        'showroom_visits',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('leads.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('appointment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('appointments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('dealership_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('dealerships.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('checked_in_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('checked_in_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=False),
        sa.Column('checked_out_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('outcome', postgresql.ENUM('sold', 'not_interested', 'follow_up', 'reschedule', 'browsing', name='showroomoutcome', create_type=False), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    
    # Create indexes
    op.create_index('ix_showroom_visits_checked_out_at', 'showroom_visits', ['checked_out_at'])


def downgrade() -> None:
    # Drop table
    op.drop_index('ix_showroom_visits_checked_out_at', table_name='showroom_visits')
    op.drop_table('showroom_visits')
    
    # Drop enum
    op.execute('DROP TYPE IF EXISTS showroomoutcome')
