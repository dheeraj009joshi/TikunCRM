"""add_lead_campaigns_multi_tracking

Revision ID: ak_add_lead_campaigns_multi_tracking
Revises: 611e9d9888f3
Create Date: 2026-02-25

Adds:
- is_starred column to leads table (for multi-campaign indicator)
- lead_campaigns junction table (track multiple campaigns per lead)
- LEAD_MULTI_CAMPAIGN notification type
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'ak_add_lead_campaigns_multi_tracking'
down_revision: Union[str, None] = '611e9d9888f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add is_starred column to leads table
    op.add_column('leads', sa.Column(
        'is_starred',
        sa.Boolean(),
        nullable=False,
        server_default='false',
        comment='Indicates lead appeared in multiple campaigns'
    ))
    op.create_index('ix_leads_is_starred', 'leads', ['is_starred'], unique=False)

    # 2. Create lead_campaigns junction table
    op.create_table(
        'lead_campaigns',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('leads.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('campaign_mapping_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('campaign_mappings.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('campaign_name', sa.String(255), nullable=False, comment='Raw campaign name from the sync source'),
        sa.Column('sync_source_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('lead_sync_sources.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('added_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()'), comment='When this campaign association was added'),
    )

    # 3. Add LEAD_MULTI_CAMPAIGN to notification type enum
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'LEAD_MULTI_CAMPAIGN'")


def downgrade() -> None:
    # 1. Drop lead_campaigns table
    op.drop_table('lead_campaigns')

    # 2. Remove is_starred column from leads
    op.drop_index('ix_leads_is_starred', table_name='leads')
    op.drop_column('leads', 'is_starred')

    # Note: PostgreSQL doesn't support removing enum values directly.
    # The LEAD_MULTI_CAMPAIGN enum value will remain but be unused.
