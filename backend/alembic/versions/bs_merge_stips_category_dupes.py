"""Merge duplicate Stips categories and enforce unique tabs per dealership.

Revision ID: bs_merge_stips_category_dupes
Revises: br_lead_sold_partner_store
Create Date: 2026-09-19
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bs_merge_stips_category_dupes"
down_revision: Union[str, None] = "br_lead_sold_partner_store"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NULL_DEALER = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(text("DROP TABLE IF EXISTS stip_cat_dupes"))
    conn.execute(text(f"""
        CREATE TEMP TABLE stip_cat_dupes AS
        WITH scored AS (
            SELECT
                c.id,
                c.dealership_id,
                c.scope,
                lower(btrim(c.name)) AS name_key,
                c.created_at,
                (
                    SELECT COUNT(*) FROM lead_stip_documents d
                    WHERE d.stips_category_id = c.id
                ) + (
                    SELECT COUNT(*) FROM customer_stip_documents d
                    WHERE d.stips_category_id = c.id
                ) AS doc_count
            FROM stips_categories c
        ),
        ranked AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY
                        COALESCE(dealership_id, '{_NULL_DEALER}'::uuid),
                        name_key,
                        scope
                    ORDER BY doc_count DESC, created_at ASC, id ASC
                ) AS rn
            FROM scored
        )
        SELECT r.id AS dupe_id, k.id AS keeper_id
        FROM ranked r
        JOIN ranked k
          ON k.rn = 1
         AND k.name_key = r.name_key
         AND k.scope = r.scope
         AND COALESCE(k.dealership_id, '{_NULL_DEALER}'::uuid)
           = COALESCE(r.dealership_id, '{_NULL_DEALER}'::uuid)
        WHERE r.rn > 1
    """))

    conn.execute(text("""
        UPDATE stips_categories AS keeper
        SET filter_key = dupe.filter_key
        FROM stip_cat_dupes map
        JOIN stips_categories AS dupe ON dupe.id = map.dupe_id
        WHERE keeper.id = map.keeper_id
          AND keeper.filter_key IS NULL
          AND dupe.filter_key IS NOT NULL
    """))

    conn.execute(text("""
        UPDATE lead_stip_documents AS docs
        SET stips_category_id = map.keeper_id
        FROM stip_cat_dupes map
        WHERE docs.stips_category_id = map.dupe_id
    """))
    conn.execute(text("""
        UPDATE customer_stip_documents AS docs
        SET stips_category_id = map.keeper_id
        FROM stip_cat_dupes map
        WHERE docs.stips_category_id = map.dupe_id
    """))

    conn.execute(text("""
        DELETE FROM lead_stip_documents a
        USING lead_stip_documents b
        WHERE a.id <> b.id
          AND a.lead_id = b.lead_id
          AND a.stips_category_id = b.stips_category_id
          AND lower(a.file_name) = lower(b.file_name)
          AND COALESCE(a.file_size, -1) = COALESCE(b.file_size, -1)
          AND (a.uploaded_at, a.id) > (b.uploaded_at, b.id)
    """))
    conn.execute(text("""
        DELETE FROM customer_stip_documents a
        USING customer_stip_documents b
        WHERE a.id <> b.id
          AND a.customer_id = b.customer_id
          AND a.stips_category_id = b.stips_category_id
          AND lower(a.file_name) = lower(b.file_name)
          AND COALESCE(a.file_size, -1) = COALESCE(b.file_size, -1)
          AND (a.uploaded_at, a.id) > (b.uploaded_at, b.id)
    """))

    conn.execute(text("""
        DELETE FROM stips_categories
        WHERE id IN (SELECT dupe_id FROM stip_cat_dupes)
    """))
    conn.execute(text("DROP TABLE IF EXISTS stip_cat_dupes"))

    idx = conn.execute(text("""
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'uq_stips_categories_dealer_name_scope'
    """)).fetchone()
    if not idx:
        conn.execute(text(f"""
            CREATE UNIQUE INDEX uq_stips_categories_dealer_name_scope
            ON stips_categories (
                COALESCE(dealership_id, '{_NULL_DEALER}'::uuid),
                lower(btrim(name)),
                scope
            )
        """))


def downgrade() -> None:
    conn = op.get_bind()
    idx = conn.execute(text("""
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'uq_stips_categories_dealer_name_scope'
    """)).fetchone()
    if idx:
        conn.execute(text("DROP INDEX IF EXISTS uq_stips_categories_dealer_name_scope"))
