"""add_dealership_email_config

Revision ID: c9567e89a1bc
Revises: b8458d78f6ca
Create Date: 2026-01-28 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c9567e89a1bc'
down_revision: Union[str, None] = 'b8458d78f6ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add dealership_email field to users table
    op.add_column('users', sa.Column('dealership_email', sa.String(length=255), nullable=True))
    
    # Add email threading fields to email_logs table
    op.add_column('email_logs', sa.Column('message_id', sa.String(length=500), nullable=True))
    op.add_column('email_logs', sa.Column('in_reply_to', sa.String(length=500), nullable=True))
    op.add_column('email_logs', sa.Column('references', sa.Text(), nullable=True))
    op.create_index(op.f('ix_email_logs_message_id'), 'email_logs', ['message_id'], unique=False)
    
    # Rename body to body_text in email_logs (if exists)
    # Note: This may need manual adjustment depending on existing data
    op.alter_column('email_logs', 'body', new_column_name='body_text')
    
    # Make lead_id nullable in email_logs
    op.alter_column('email_logs', 'lead_id', nullable=True)
    
    # Create notifications table
    op.create_table('notifications',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('type', sa.Enum('EMAIL_RECEIVED', 'LEAD_ASSIGNED', 'LEAD_UPDATED', 'FOLLOW_UP_DUE', 'FOLLOW_UP_OVERDUE', 'SYSTEM', 'MENTION', name='notificationtype'), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('link', sa.String(length=500), nullable=True),
        sa.Column('related_id', sa.UUID(), nullable=True),
        sa.Column('related_type', sa.String(length=50), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notifications_user_id'), 'notifications', ['user_id'], unique=False)
    op.create_index(op.f('ix_notifications_is_read'), 'notifications', ['is_read'], unique=False)
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    op.create_index(op.f('ix_notifications_related_id'), 'notifications', ['related_id'], unique=False)
    
    # Create dealership_email_configs table
    op.create_table('dealership_email_configs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('dealership_id', sa.UUID(), nullable=False),
        
        # SMTP Settings
        sa.Column('smtp_host', sa.String(length=255), nullable=False),
        sa.Column('smtp_port', sa.Integer(), nullable=False, server_default='465'),
        sa.Column('smtp_username', sa.String(length=255), nullable=False),
        sa.Column('smtp_password', sa.Text(), nullable=False),
        sa.Column('smtp_use_ssl', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('smtp_use_tls', sa.Boolean(), nullable=False, server_default='false'),
        
        # IMAP Settings
        sa.Column('imap_host', sa.String(length=255), nullable=True),
        sa.Column('imap_port', sa.Integer(), nullable=False, server_default='993'),
        sa.Column('imap_username', sa.String(length=255), nullable=True),
        sa.Column('imap_password', sa.Text(), nullable=True),
        sa.Column('imap_use_ssl', sa.Boolean(), nullable=False, server_default='true'),
        
        # Display settings
        sa.Column('from_name', sa.String(length=255), nullable=True),
        
        # Status tracking
        sa.Column('is_verified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        
        # IMAP sync tracking
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_uid', sa.Integer(), nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        
        sa.ForeignKeyConstraint(['dealership_id'], ['dealerships.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('dealership_id')
    )
    op.create_index(op.f('ix_dealership_email_configs_dealership_id'), 'dealership_email_configs', ['dealership_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_dealership_email_configs_dealership_id'), table_name='dealership_email_configs')
    op.drop_table('dealership_email_configs')
    
    op.drop_index(op.f('ix_notifications_related_id'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_is_read'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_user_id'), table_name='notifications')
    op.drop_table('notifications')
    op.execute('DROP TYPE IF EXISTS notificationtype')
    
    op.drop_column('users', 'dealership_email')
    
    # Revert email_logs changes
    op.alter_column('email_logs', 'lead_id', nullable=False)
    op.alter_column('email_logs', 'body_text', new_column_name='body')
    op.drop_index(op.f('ix_email_logs_message_id'), table_name='email_logs')
    op.drop_column('email_logs', 'references')
    op.drop_column('email_logs', 'in_reply_to')
    op.drop_column('email_logs', 'message_id')
