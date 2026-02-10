"""Customer + LeadStage architecture rewrite

Creates customers and lead_stages tables; reshapes leads table
to use customer_id + stage_id instead of contact fields + status enum.

Revision ID: w_customer_lead_rewrite
Revises: v9012345678s
Create Date: 2026-02-08

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "w_customer_lead_rewrite"
down_revision = "v9012345678s"
branch_labels = None
depends_on = None

# Default global stages to seed
DEFAULT_STAGES = [
    ("new", "New", 1, "#3B82F6", False),
    ("contacted", "Contacted", 2, "#F59E0B", False),
    ("follow_up", "Follow Up", 3, "#8B5CF6", False),
    ("interested", "Interested", 4, "#10B981", False),
    ("in_showroom", "In Showroom", 5, "#F97316", False),
    ("negotiation", "Negotiation", 6, "#06B6D4", False),
    ("browsing", "Browsing", 7, "#EAB308", False),
    ("reschedule", "Reschedule", 8, "#A855F7", False),
    ("converted", "Converted", 100, "#059669", True),
    ("lost", "Lost", 101, "#E11D48", True),
    ("not_interested", "Not Interested", 102, "#6B7280", True),
    ("couldnt_qualify", "Couldn't Qualify", 103, "#D97706", True),
]


def upgrade() -> None:
    # ── 1. Create customers table ──────────────────────────────────
    op.create_table(
        "customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True, unique=True),
        sa.Column("email", sa.String(255), nullable=True, unique=True),
        sa.Column("alternate_phone", sa.String(20), nullable=True),
        sa.Column("whatsapp", sa.String(20), nullable=True),
        sa.Column("address", sa.String(500), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("state", sa.String(100), nullable=True),
        sa.Column("postal_code", sa.String(20), nullable=True),
        sa.Column("country", sa.String(100), nullable=True),
        sa.Column("date_of_birth", sa.DateTime(timezone=True), nullable=True),
        sa.Column("company", sa.String(200), nullable=True),
        sa.Column("job_title", sa.String(100), nullable=True),
        sa.Column("preferred_contact_method", sa.String(50), nullable=True),
        sa.Column("preferred_contact_time", sa.String(100), nullable=True),
        sa.Column("source_first_touch", sa.String(50), nullable=True),
        sa.Column("lifetime_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("meta_data", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_customers_phone", "customers", ["phone"], unique=True, postgresql_where=sa.text("phone IS NOT NULL"))
    op.create_index("idx_customers_email", "customers", ["email"], unique=True, postgresql_where=sa.text("email IS NOT NULL"))

    # ── 2. Create lead_stages table ────────────────────────────────
    op.create_table(
        "lead_stages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("dealership_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dealerships.id", ondelete="CASCADE"), nullable=True),
        sa.Column("is_terminal", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_lead_stages_dealership", "lead_stages", ["dealership_id"])

    # ── 3. Seed global default stages ──────────────────────────────
    lead_stages = sa.table(
        "lead_stages",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("display_name", sa.String),
        sa.column("order", sa.Integer),
        sa.column("color", sa.String),
        sa.column("is_terminal", sa.Boolean),
        sa.column("dealership_id", postgresql.UUID(as_uuid=True)),
    )
    for name, display_name, order, color, is_terminal in DEFAULT_STAGES:
        op.execute(
            lead_stages.insert().values(
                id=sa.text("gen_random_uuid()"),
                name=name,
                display_name=display_name,
                order=order,
                color=color,
                is_terminal=is_terminal,
                dealership_id=None,
            )
        )

    # ── 4. Add new columns to leads (nullable initially) ──────────
    op.add_column("leads", sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("leads", sa.Column("stage_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("leads", sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("leads", sa.Column("outcome", sa.String(50), nullable=True))
    op.add_column("leads", sa.Column("interest_score", sa.Integer(), server_default="0", nullable=False))
    op.add_column("leads", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))

    # ── 5. Backfill: create a customer for each lead ───────────────
    # We use raw SQL for the data migration since ORM isn't available in Alembic.
    conn = op.get_bind()

    # Insert unique customers from leads (grouped by phone, falling back to id for uniqueness)
    conn.execute(sa.text("""
        INSERT INTO customers (id, first_name, last_name, phone, email, alternate_phone,
                               address, city, state, postal_code, country,
                               date_of_birth, company, job_title,
                               preferred_contact_method, preferred_contact_time,
                               source_first_touch, meta_data, created_at, updated_at)
        SELECT DISTINCT ON (COALESCE(NULLIF(phone, ''), id::text))
               gen_random_uuid(), first_name, last_name, NULLIF(phone, ''), NULLIF(email, ''),
               alternate_phone, address, city, state, postal_code, country,
               date_of_birth, company, job_title,
               preferred_contact_method, preferred_contact_time,
               source::text, '{}'::jsonb, created_at, updated_at
        FROM leads
        ORDER BY COALESCE(NULLIF(phone, ''), id::text), created_at ASC
    """))

    # Set customer_id on each lead by matching phone (primary) or email
    conn.execute(sa.text("""
        UPDATE leads SET customer_id = c.id
        FROM customers c
        WHERE (leads.phone IS NOT NULL AND leads.phone != '' AND leads.phone = c.phone)
           OR (leads.email IS NOT NULL AND leads.email != '' AND leads.email = c.email
               AND leads.customer_id IS NULL)
    """))

    # For any leads still without customer_id (no phone, no email), create individual customers
    conn.execute(sa.text("""
        WITH orphan_leads AS (
            SELECT id, first_name, last_name, created_at, updated_at
            FROM leads WHERE customer_id IS NULL
        ),
        new_custs AS (
            INSERT INTO customers (id, first_name, last_name, source_first_touch, meta_data, created_at, updated_at)
            SELECT gen_random_uuid(), first_name, last_name, 'unknown', '{}'::jsonb, created_at, updated_at
            FROM orphan_leads
            RETURNING id, first_name, last_name, created_at
        )
        UPDATE leads SET customer_id = nc.id
        FROM new_custs nc
        WHERE leads.customer_id IS NULL
          AND leads.first_name = nc.first_name
          AND COALESCE(leads.last_name, '') = COALESCE(nc.last_name, '')
          AND leads.created_at = nc.created_at
    """))

    # ── 6. Backfill: map status enum to stage_id ──────────────────
    conn.execute(sa.text("""
        UPDATE leads SET stage_id = ls.id
        FROM lead_stages ls
        WHERE ls.dealership_id IS NULL
          AND ls.name = leads.status::text
    """))
    # Fallback: set remaining to 'new' stage
    conn.execute(sa.text("""
        UPDATE leads SET stage_id = (SELECT id FROM lead_stages WHERE name = 'new' AND dealership_id IS NULL LIMIT 1)
        WHERE stage_id IS NULL
    """))

    # Map is_active / outcome from old status
    conn.execute(sa.text("""
        UPDATE leads SET is_active = false, outcome = 'converted'
        WHERE status::text = 'converted'
    """))
    conn.execute(sa.text("""
        UPDATE leads SET is_active = false, outcome = 'lost'
        WHERE status::text = 'lost'
    """))
    conn.execute(sa.text("""
        UPDATE leads SET is_active = false, outcome = status::text
        WHERE status::text IN ('not_interested', 'couldnt_qualify')
    """))

    # ── 7. Make customer_id and stage_id NOT NULL ─────────────────
    op.alter_column("leads", "customer_id", nullable=False)
    op.alter_column("leads", "stage_id", nullable=False)
    op.create_foreign_key("fk_leads_customer_id", "leads", "customers", ["customer_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_leads_stage_id", "leads", "lead_stages", ["stage_id"], ["id"], ondelete="RESTRICT")
    op.create_index("idx_leads_customer_id", "leads", ["customer_id"])
    op.create_index("idx_leads_stage_id", "leads", ["stage_id"])
    op.create_index("idx_leads_is_active", "leads", ["is_active"])

    # ── 8. Drop old contact columns from leads ─────────────────────
    for col in ("first_name", "last_name", "email", "phone", "alternate_phone",
                "address", "city", "state", "postal_code", "country",
                "date_of_birth", "company", "job_title",
                "preferred_contact_method", "preferred_contact_time", "status"):
        try:
            op.drop_column("leads", col)
        except Exception:
            pass  # Column may not exist

    # ── 9. Drop old leadstatus enum type (cleanup) ─────────────────
    try:
        op.execute("DROP TYPE IF EXISTS leadstatus")
    except Exception:
        pass


def downgrade() -> None:
    # This migration is not easily reversible due to data reshaping.
    # In development, drop and recreate the database.
    raise NotImplementedError("Downgrade not supported for customer-lead rewrite migration")
