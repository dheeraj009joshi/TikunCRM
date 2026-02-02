"""Add SendGrid tracking fields

Revision ID: d1234567890a
Revises: c9567e89a1bc
Create Date: 2025-01-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1234567890a'
down_revision: Union[str, None] = 'c9567e89a1bc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the EmailDeliveryStatus enum type
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE emaildeliverystatus AS ENUM (
                'pending', 'sent', 'delivered', 'opened', 
                'clicked', 'bounced', 'dropped', 'spam', 'failed'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    # Add SendGrid tracking columns to email_logs table
    op.add_column('email_logs', sa.Column('sendgrid_message_id', sa.String(255), nullable=True))
    op.add_column('email_logs', sa.Column('delivery_status', sa.Enum(
        'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'dropped', 'spam', 'failed',
        name='emaildeliverystatus', create_type=False
    ), nullable=True))
    op.add_column('email_logs', sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('email_logs', sa.Column('clicked_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('email_logs', sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('email_logs', sa.Column('bounce_reason', sa.Text(), nullable=True))
    op.add_column('email_logs', sa.Column('open_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('email_logs', sa.Column('click_count', sa.Integer(), nullable=False, server_default='0'))
    
    # Create index on sendgrid_message_id for webhook matching
    op.create_index('ix_email_logs_sendgrid_message_id', 'email_logs', ['sendgrid_message_id'])
    
    # Add slug column to dealerships table for email routing
    op.add_column('dealerships', sa.Column('slug', sa.String(100), nullable=True))
    op.create_index('ix_dealerships_slug', 'dealerships', ['slug'], unique=True)
    
    # Generate slugs for existing dealerships
    op.execute("""
        UPDATE dealerships 
        SET slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '-', 'g'), '-+', '-', 'g'))
        WHERE slug IS NULL
    """)
    
    # Add from_email column to dealership_email_configs for per-dealership sender
    op.add_column('dealership_email_configs', sa.Column('from_email', sa.String(255), nullable=True))


def downgrade() -> None:
    # Remove from_email from dealership_email_configs
    op.drop_column('dealership_email_configs', 'from_email')
    
    # Remove dealership slug
    op.drop_index('ix_dealerships_slug', table_name='dealerships')
    op.drop_column('dealerships', 'slug')
    
    # Remove SendGrid tracking columns
    op.drop_index('ix_email_logs_sendgrid_message_id', table_name='email_logs')
    op.drop_column('email_logs', 'click_count')
    op.drop_column('email_logs', 'open_count')
    op.drop_column('email_logs', 'bounce_reason')
    op.drop_column('email_logs', 'delivered_at')
    op.drop_column('email_logs', 'clicked_at')
    op.drop_column('email_logs', 'opened_at')
    op.drop_column('email_logs', 'delivery_status')
    op.drop_column('email_logs', 'sendgrid_message_id')
    
    # Drop the enum type
    op.execute("DROP TYPE IF EXISTS emaildeliverystatus")
