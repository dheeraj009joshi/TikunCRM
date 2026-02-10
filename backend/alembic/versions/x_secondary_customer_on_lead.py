"""Add secondary_customer_id to leads

Revision ID: x_secondary_customer_on_lead
Revises: w_customer_lead_rewrite
Create Date: 2026-02-08

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "x_secondary_customer_on_lead"
down_revision = "w_customer_lead_rewrite"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column("secondary_customer_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "idx_leads_secondary_customer_id",
        "leads",
        ["secondary_customer_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_leads_secondary_customer_id",
        "leads",
        "customers",
        ["secondary_customer_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_leads_secondary_customer_id", "leads", type_="foreignkey")
    op.drop_index("idx_leads_secondary_customer_id", table_name="leads")
    op.drop_column("leads", "secondary_customer_id")
