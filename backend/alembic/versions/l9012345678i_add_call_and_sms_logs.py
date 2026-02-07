"""Add call_logs and sms_logs tables for Twilio voice and SMS

Revision ID: l9012345678i
Revises: k8901234567h
Create Date: 2026-02-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'l9012345678i'
down_revision = 'bcb133697f3d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create CallDirection enum
    call_direction_enum = postgresql.ENUM('inbound', 'outbound', name='calldirection', create_type=False)
    call_direction_enum.create(op.get_bind(), checkfirst=True)
    
    # Create CallStatus enum
    call_status_enum = postgresql.ENUM(
        'initiated', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled',
        name='callstatus', create_type=False
    )
    call_status_enum.create(op.get_bind(), checkfirst=True)
    
    # Create MessageDirection enum
    message_direction_enum = postgresql.ENUM('inbound', 'outbound', name='messagedirection', create_type=False)
    message_direction_enum.create(op.get_bind(), checkfirst=True)
    
    # Create SMSStatus enum
    sms_status_enum = postgresql.ENUM(
        'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received',
        name='smsstatus', create_type=False
    )
    sms_status_enum.create(op.get_bind(), checkfirst=True)
    
    # Create call_logs table
    op.create_table(
        'call_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('dealership_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('twilio_call_sid', sa.String(64), nullable=False),
        sa.Column('twilio_parent_call_sid', sa.String(64), nullable=True),
        sa.Column('direction', postgresql.ENUM('inbound', 'outbound', name='calldirection', create_type=False), nullable=False),
        sa.Column('from_number', sa.String(20), nullable=False),
        sa.Column('to_number', sa.String(20), nullable=False),
        sa.Column('status', postgresql.ENUM('initiated', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled', name='callstatus', create_type=False), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('recording_url', sa.String(1000), nullable=True),
        sa.Column('recording_sid', sa.String(64), nullable=True),
        sa.Column('recording_duration_seconds', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('outcome', sa.String(50), nullable=True),
        sa.Column('meta_data', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('activity_logged', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['dealership_id'], ['dealerships.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for call_logs
    op.create_index('ix_call_logs_lead_id', 'call_logs', ['lead_id'])
    op.create_index('ix_call_logs_user_id', 'call_logs', ['user_id'])
    op.create_index('ix_call_logs_dealership_id', 'call_logs', ['dealership_id'])
    op.create_index('ix_call_logs_twilio_call_sid', 'call_logs', ['twilio_call_sid'], unique=True)
    op.create_index('ix_call_logs_direction', 'call_logs', ['direction'])
    op.create_index('ix_call_logs_status', 'call_logs', ['status'])
    
    # Create sms_logs table
    op.create_table(
        'sms_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('dealership_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('twilio_message_sid', sa.String(64), nullable=False),
        sa.Column('direction', postgresql.ENUM('inbound', 'outbound', name='messagedirection', create_type=False), nullable=False),
        sa.Column('from_number', sa.String(20), nullable=False),
        sa.Column('to_number', sa.String(20), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('media_urls', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('status', postgresql.ENUM('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received', name='smsstatus', create_type=False), nullable=False),
        sa.Column('error_code', sa.String(10), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('meta_data', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('activity_logged', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['dealership_id'], ['dealerships.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for sms_logs
    op.create_index('ix_sms_logs_lead_id', 'sms_logs', ['lead_id'])
    op.create_index('ix_sms_logs_user_id', 'sms_logs', ['user_id'])
    op.create_index('ix_sms_logs_dealership_id', 'sms_logs', ['dealership_id'])
    op.create_index('ix_sms_logs_twilio_message_sid', 'sms_logs', ['twilio_message_sid'], unique=True)
    op.create_index('ix_sms_logs_direction', 'sms_logs', ['direction'])
    op.create_index('ix_sms_logs_status', 'sms_logs', ['status'])
    op.create_index('ix_sms_logs_is_read', 'sms_logs', ['is_read'])
    op.create_index('ix_sms_logs_created_at', 'sms_logs', ['created_at'])
    
    # Add new activity types for SMS received
    op.execute("ALTER TYPE activitytype ADD VALUE IF NOT EXISTS 'sms_received'")


def downgrade() -> None:
    # Drop sms_logs table and indexes
    op.drop_index('ix_sms_logs_created_at', table_name='sms_logs')
    op.drop_index('ix_sms_logs_is_read', table_name='sms_logs')
    op.drop_index('ix_sms_logs_status', table_name='sms_logs')
    op.drop_index('ix_sms_logs_direction', table_name='sms_logs')
    op.drop_index('ix_sms_logs_twilio_message_sid', table_name='sms_logs')
    op.drop_index('ix_sms_logs_dealership_id', table_name='sms_logs')
    op.drop_index('ix_sms_logs_user_id', table_name='sms_logs')
    op.drop_index('ix_sms_logs_lead_id', table_name='sms_logs')
    op.drop_table('sms_logs')
    
    # Drop call_logs table and indexes
    op.drop_index('ix_call_logs_status', table_name='call_logs')
    op.drop_index('ix_call_logs_direction', table_name='call_logs')
    op.drop_index('ix_call_logs_twilio_call_sid', table_name='call_logs')
    op.drop_index('ix_call_logs_dealership_id', table_name='call_logs')
    op.drop_index('ix_call_logs_user_id', table_name='call_logs')
    op.drop_index('ix_call_logs_lead_id', table_name='call_logs')
    op.drop_table('call_logs')
    
    # Drop enums
    op.execute("DROP TYPE IF EXISTS smsstatus")
    op.execute("DROP TYPE IF EXISTS messagedirection")
    op.execute("DROP TYPE IF EXISTS callstatus")
    op.execute("DROP TYPE IF EXISTS calldirection")
