"""Add stips_categories, customer_stip_documents, lead_stip_documents

Revision ID: ac_stips_tables
Revises: ab_whatsapp_templates
Create Date: 2026-02-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ac_stips_tables"
down_revision = "ab_whatsapp_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stips_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scope", sa.String(20), nullable=False, server_default="lead"),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["dealership_id"], ["dealerships.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_stips_categories_dealership", "stips_categories", ["dealership_id"])

    op.create_table(
        "customer_stip_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stips_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("blob_path", sa.String(1024), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stips_category_id"], ["stips_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_customer_stip_docs_customer", "customer_stip_documents", ["customer_id"])
    op.create_index("idx_customer_stip_docs_category", "customer_stip_documents", ["stips_category_id"])

    op.create_table(
        "lead_stip_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stips_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_name", sa.String(512), nullable=False),
        sa.Column("blob_path", sa.String(1024), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stips_category_id"], ["stips_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_lead_stip_docs_lead", "lead_stip_documents", ["lead_id"])
    op.create_index("idx_lead_stip_docs_category", "lead_stip_documents", ["stips_category_id"])


def downgrade() -> None:
    op.drop_table("lead_stip_documents")
    op.drop_table("customer_stip_documents")
    op.drop_table("stips_categories")
