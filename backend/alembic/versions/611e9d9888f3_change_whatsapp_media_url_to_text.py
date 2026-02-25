"""change_whatsapp_media_url_to_text

Revision ID: 611e9d9888f3
Revises: aj_add_whatsapp_messages
Create Date: 2026-02-25 14:04:04.645540

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '611e9d9888f3'
down_revision: Union[str, None] = 'aj_add_whatsapp_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Change media_url from VARCHAR(500) to TEXT to support base64 data URLs
    op.alter_column('whatsapp_messages', 'media_url',
               existing_type=sa.VARCHAR(length=500),
               type_=sa.Text(),
               existing_nullable=True)


def downgrade() -> None:
    # Revert media_url back to VARCHAR(500)
    op.alter_column('whatsapp_messages', 'media_url',
               existing_type=sa.Text(),
               type_=sa.VARCHAR(length=500),
               existing_nullable=True)
