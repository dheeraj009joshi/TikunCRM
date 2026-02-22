"""Add lead_sync_sources and campaign_mappings tables

Revision ID: ai_add_lead_sync_sources
Revises: ah_add_call_log_voice_features
Create Date: 2026-01-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ai_add_lead_sync_sources"
down_revision = "ah_add_call_log_voice_features"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types (DO block so "already exists" does not fail)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE syncsourcetype AS ENUM ('google_sheets', 'csv_upload', 'api');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE matchtype AS ENUM ('exact', 'contains', 'starts_with', 'ends_with', 'regex');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
    """)

    # Create lead_sync_sources table (columns use create_type=False so we don't create enums again)
    op.create_table(
        "lead_sync_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False, comment="Internal name for identification"),
        sa.Column("display_name", sa.String(150), nullable=False, comment="Display name shown in UI"),
        sa.Column("description", sa.Text(), nullable=True, comment="Optional description of this sync source"),
        sa.Column(
            "source_type",
            postgresql.ENUM("google_sheets", "csv_upload", "api", name="syncsourcetype", create_type=False),
            nullable=False,
            server_default="google_sheets"
        ),
        sa.Column("sheet_id", sa.String(100), nullable=False, comment="Google Sheet ID (from URL)"),
        sa.Column("sheet_gid", sa.String(20), nullable=False, server_default="0", comment="Sheet tab GID"),
        sa.Column(
            "default_dealership_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="Default dealership for leads"
        ),
        sa.Column(
            "default_campaign_display",
            sa.String(150),
            nullable=True,
            comment="Display name when no campaign mapping matches"
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sync_interval_minutes", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_lead_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_leads_synced", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["default_dealership_id"],
            ["dealerships.id"],
            name="fk_lead_sync_sources_dealership",
            ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_lead_sync_sources_creator",
            ondelete="SET NULL"
        ),
    )
    op.create_index("ix_lead_sync_sources_default_dealership", "lead_sync_sources", ["default_dealership_id"])
    op.create_index("ix_lead_sync_sources_is_active", "lead_sync_sources", ["is_active"])

    # Create campaign_mappings table
    op.create_table(
        "campaign_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sync_source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("match_pattern", sa.String(255), nullable=False, comment="Pattern to match in campaign name"),
        sa.Column(
            "match_type",
            postgresql.ENUM("exact", "contains", "starts_with", "ends_with", "regex", name="matchtype", create_type=False),
            nullable=False,
            server_default="contains"
        ),
        sa.Column("display_name", sa.String(255), nullable=False, comment="Display name for frontend"),
        sa.Column(
            "dealership_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="Dealership for leads (overrides sync source default)"
        ),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("leads_matched", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["sync_source_id"],
            ["lead_sync_sources.id"],
            name="fk_campaign_mappings_sync_source",
            ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["dealership_id"],
            ["dealerships.id"],
            name="fk_campaign_mappings_dealership",
            ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_campaign_mappings_creator",
            ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name="fk_campaign_mappings_updater",
            ondelete="SET NULL"
        ),
        sa.UniqueConstraint("sync_source_id", "match_pattern", name="uq_campaign_mapping_source_pattern"),
    )
    op.create_index("ix_campaign_mappings_sync_source", "campaign_mappings", ["sync_source_id"])
    op.create_index("ix_campaign_mappings_dealership", "campaign_mappings", ["dealership_id"])

    # Add new columns to leads table
    op.add_column(
        "leads",
        sa.Column(
            "sync_source_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="Sync source this lead came from"
        )
    )
    op.add_column(
        "leads",
        sa.Column(
            "campaign_mapping_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="Campaign mapping that matched this lead"
        )
    )
    op.add_column(
        "leads",
        sa.Column(
            "source_campaign_raw",
            sa.String(255),
            nullable=True,
            comment="Original campaign name from the sync source"
        )
    )

    # Add foreign keys to leads table
    op.create_foreign_key(
        "fk_leads_sync_source",
        "leads",
        "lead_sync_sources",
        ["sync_source_id"],
        ["id"],
        ondelete="SET NULL"
    )
    op.create_foreign_key(
        "fk_leads_campaign_mapping",
        "leads",
        "campaign_mappings",
        ["campaign_mapping_id"],
        ["id"],
        ondelete="SET NULL"
    )
    op.create_index("ix_leads_sync_source", "leads", ["sync_source_id"])
    op.create_index("ix_leads_campaign_mapping", "leads", ["campaign_mapping_id"])


def downgrade() -> None:
    # Remove indexes and foreign keys from leads
    op.drop_index("ix_leads_campaign_mapping", table_name="leads")
    op.drop_index("ix_leads_sync_source", table_name="leads")
    op.drop_constraint("fk_leads_campaign_mapping", "leads", type_="foreignkey")
    op.drop_constraint("fk_leads_sync_source", "leads", type_="foreignkey")

    # Remove columns from leads
    op.drop_column("leads", "source_campaign_raw")
    op.drop_column("leads", "campaign_mapping_id")
    op.drop_column("leads", "sync_source_id")

    # Drop campaign_mappings table
    op.drop_index("ix_campaign_mappings_dealership", table_name="campaign_mappings")
    op.drop_index("ix_campaign_mappings_sync_source", table_name="campaign_mappings")
    op.drop_table("campaign_mappings")

    # Drop lead_sync_sources table
    op.drop_index("ix_lead_sync_sources_is_active", table_name="lead_sync_sources")
    op.drop_index("ix_lead_sync_sources_default_dealership", table_name="lead_sync_sources")
    op.drop_table("lead_sync_sources")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS matchtype")
    op.execute("DROP TYPE IF EXISTS syncsourcetype")
