"""Add user IMAP configuration fields

Revision ID: f3456789012c
Revises: e2345678901b
Create Date: 2026-01-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3456789012c'
down_revision: Union[str, None] = 'e2345678901b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add IMAP configuration fields to users table
    op.add_column('users', sa.Column('imap_host', sa.String(255), nullable=True,
                                      server_default='imap.hostinger.com',
                                      comment="IMAP server host"))
    op.add_column('users', sa.Column('imap_port', sa.Integer(), nullable=False,
                                      server_default='993',
                                      comment="IMAP port"))
    op.add_column('users', sa.Column('imap_password_encrypted', sa.String(500), nullable=True,
                                      comment="Encrypted IMAP password"))
    op.add_column('users', sa.Column('imap_use_ssl', sa.Boolean(), nullable=False,
                                      server_default='true',
                                      comment="Use SSL for IMAP"))
    op.add_column('users', sa.Column('imap_last_sync_at', sa.DateTime(timezone=True), nullable=True,
                                      comment="Last IMAP sync time"))


def downgrade() -> None:
    op.drop_column('users', 'imap_last_sync_at')
    op.drop_column('users', 'imap_use_ssl')
    op.drop_column('users', 'imap_password_encrypted')
    op.drop_column('users', 'imap_port')
    op.drop_column('users', 'imap_host')
