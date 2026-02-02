"""Add user email configuration fields

Revision ID: e2345678901b
Revises: d1234567890a
Create Date: 2026-01-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2345678901b'
down_revision: Union[str, None] = 'd1234567890a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add email configuration fields to users table
    op.add_column('users', sa.Column('smtp_email', sa.String(255), nullable=True, 
                                      comment="User's email address for sending"))
    op.add_column('users', sa.Column('smtp_host', sa.String(255), nullable=True, 
                                      server_default='smtp.hostinger.com',
                                      comment="SMTP server host"))
    op.add_column('users', sa.Column('smtp_port', sa.Integer(), nullable=False, 
                                      server_default='465',
                                      comment="SMTP port"))
    op.add_column('users', sa.Column('smtp_password_encrypted', sa.String(500), nullable=True,
                                      comment="Encrypted SMTP password"))
    op.add_column('users', sa.Column('smtp_use_ssl', sa.Boolean(), nullable=False, 
                                      server_default='true',
                                      comment="Use SSL for SMTP"))
    op.add_column('users', sa.Column('email_config_verified', sa.Boolean(), nullable=False, 
                                      server_default='false',
                                      comment="Email config tested successfully"))


def downgrade() -> None:
    op.drop_column('users', 'email_config_verified')
    op.drop_column('users', 'smtp_use_ssl')
    op.drop_column('users', 'smtp_password_encrypted')
    op.drop_column('users', 'smtp_port')
    op.drop_column('users', 'smtp_host')
    op.drop_column('users', 'smtp_email')
