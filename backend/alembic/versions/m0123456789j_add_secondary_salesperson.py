"""Add secondary_salesperson_id to leads and IN_SHOWROOM status

Revision ID: m0123456789j
Revises: l9012345678i
Create Date: 2026-01-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'm0123456789j'
down_revision = 'l9012345678i'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add secondary_salesperson_id column to leads table
    op.add_column('leads', sa.Column(
        'secondary_salesperson_id',
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True
    ))
    
    # Create index for secondary_salesperson_id
    op.create_index(
        'ix_leads_secondary_salesperson_id',
        'leads',
        ['secondary_salesperson_id'],
        unique=False
    )
    
    # Add IN_SHOWROOM to leadstatus enum
    op.execute("ALTER TYPE leadstatus ADD VALUE IF NOT EXISTS 'in_showroom'")
    
    # Add new appointment status values
    op.execute("ALTER TYPE appointmentstatus ADD VALUE IF NOT EXISTS 'arrived'")
    op.execute("ALTER TYPE appointmentstatus ADD VALUE IF NOT EXISTS 'in_showroom'")
    op.execute("ALTER TYPE appointmentstatus ADD VALUE IF NOT EXISTS 'sold'")


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_leads_secondary_salesperson_id', table_name='leads')
    
    # Remove column
    op.drop_column('leads', 'secondary_salesperson_id')
    
    # Note: Removing enum values is complex in PostgreSQL
    # We'll leave 'in_showroom' in the enum as it's harmless
