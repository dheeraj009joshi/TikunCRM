"""Add partner_stores table and lead partner fields.

Partner stores are external dealerships where Carvaminos connects
approved customers to purchase vehicles.

Revision ID: bi_partner_stores
Revises: bh_carvaminos
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "bi_partner_stores"
down_revision: Union[str, None] = "bh_carvaminos"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "partner_stores",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("brand", sa.String(100), nullable=True, index=True,
                  comment="Vehicle brand this partner sells (e.g. Toyota, Ford, Honda)"),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("state", sa.String(100), nullable=True),
        sa.Column("country", sa.String(100), nullable=True, server_default="US"),
        sa.Column("postal_code", sa.String(20), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("website", sa.String(255), nullable=True),
        sa.Column("contact_person", sa.String(255), nullable=True,
                  comment="Primary contact at the partner store"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )

    # Add partner fields to leads
    op.add_column("leads", sa.Column(
        "interested_brand", sa.String(100), nullable=True, index=True,
        comment="Vehicle brand the customer is interested in (e.g. Toyota, Ford)",
    ))
    op.add_column("leads", sa.Column(
        "partner_store_id", postgresql.UUID(as_uuid=True), nullable=True, index=True,
        comment="Partner dealership where approved customer will purchase",
    ))
    op.add_column("leads", sa.Column(
        "partner_connected_at", sa.DateTime(timezone=True), nullable=True,
        comment="When the lead was connected to a partner store",
    ))
    op.create_foreign_key(
        "fk_leads_partner_store_id",
        "leads", "partner_stores",
        ["partner_store_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_leads_partner_store_id", "leads", type_="foreignkey")
    op.drop_column("leads", "partner_connected_at")
    op.drop_column("leads", "partner_store_id")
    op.drop_column("leads", "interested_brand")
    op.drop_table("partner_stores")
