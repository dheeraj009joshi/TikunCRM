"""Phase 1 Features - Appointments, Password Reset, Auto-Assignment

Revision ID: i6789012345f
Revises: h5678901234e
Create Date: 2026-01-28 12:00:00.000000

This migration adds:
1. users.must_change_password - Force password change on first login
2. users.password_changed_at - Track last password change
3. password_reset_tokens table - For forgot password flow
4. appointments table - For scheduling calls, emails, meetings
5. leads.last_activity_at - For auto-assignment tracking
6. lead_unassigned activity type
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'i6789012345f'
down_revision = 'h5678901234e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add password management fields to users table
    op.add_column('users', sa.Column(
        'must_change_password',
        sa.Boolean(),
        nullable=False,
        server_default='false',
        comment='Force user to change password on next login'
    ))
    op.add_column('users', sa.Column(
        'password_changed_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='Last time password was changed'
    ))
    
    # 2. Create password_reset_tokens table
    op.create_table(
        'password_reset_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_password_reset_tokens_user_id', 'password_reset_tokens', ['user_id'])
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'])
    
    # 3. Create appointments table
    # First create the enum types using raw SQL (IF NOT EXISTS)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE appointmenttype AS ENUM ('phone_call', 'email', 'in_person', 'video_call', 'other');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE appointmentstatus AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    op.create_table(
        'appointments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('dealership_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('scheduled_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('assigned_to', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('appointment_type', postgresql.ENUM('phone_call', 'email', 'in_person', 'video_call', 'other', name='appointmenttype', create_type=False), nullable=False),
        sa.Column('status', postgresql.ENUM('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled', name='appointmentstatus', create_type=False), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('duration_minutes', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('location', sa.String(500), nullable=True),
        sa.Column('meeting_link', sa.String(500), nullable=True),
        sa.Column('reminder_sent', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('outcome_notes', sa.Text(), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['dealership_id'], ['dealerships.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scheduled_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['assigned_to'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_appointments_lead_id', 'appointments', ['lead_id'])
    op.create_index('ix_appointments_dealership_id', 'appointments', ['dealership_id'])
    op.create_index('ix_appointments_scheduled_by', 'appointments', ['scheduled_by'])
    op.create_index('ix_appointments_assigned_to', 'appointments', ['assigned_to'])
    op.create_index('ix_appointments_scheduled_at', 'appointments', ['scheduled_at'])
    op.create_index('ix_appointments_status', 'appointments', ['status'])
    
    # 4. Add last_activity_at to leads table
    op.add_column('leads', sa.Column(
        'last_activity_at',
        sa.DateTime(timezone=True),
        nullable=True,
        comment='Last activity timestamp for auto-assignment tracking'
    ))
    op.create_index('ix_leads_last_activity_at', 'leads', ['last_activity_at'])
    
    # 5. Add lead_unassigned to activity type enum
    # PostgreSQL requires adding enum values separately
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'lead_unassigned'")


def downgrade() -> None:
    # 5. Remove lead_unassigned from activity type enum (not easily reversible in PostgreSQL)
    # We'll leave the enum value as it won't cause issues
    
    # 4. Remove last_activity_at from leads
    op.drop_index('ix_leads_last_activity_at', table_name='leads')
    op.drop_column('leads', 'last_activity_at')
    
    # 3. Drop appointments table and enums
    op.drop_index('ix_appointments_status', table_name='appointments')
    op.drop_index('ix_appointments_scheduled_at', table_name='appointments')
    op.drop_index('ix_appointments_assigned_to', table_name='appointments')
    op.drop_index('ix_appointments_scheduled_by', table_name='appointments')
    op.drop_index('ix_appointments_dealership_id', table_name='appointments')
    op.drop_index('ix_appointments_lead_id', table_name='appointments')
    op.drop_table('appointments')
    
    # Drop enum types
    op.execute("DROP TYPE IF EXISTS appointmentstatus")
    op.execute("DROP TYPE IF EXISTS appointmenttype")
    
    # 2. Drop password_reset_tokens table
    op.drop_index('ix_password_reset_tokens_token_hash', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_user_id', table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
    
    # 1. Remove password management fields from users
    op.drop_column('users', 'password_changed_at')
    op.drop_column('users', 'must_change_password')
