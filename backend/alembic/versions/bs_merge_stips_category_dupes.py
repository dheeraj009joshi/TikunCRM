"""Merge duplicate Stips category tabs (same name) and enforce uniqueness.

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
    # Same visible tab name = duplicate, even if scope differs (lead vs customer).
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
                        name_key
                    ORDER BY
                        CASE WHEN scope = 'customer' THEN 0 ELSE 1 END,
                        doc_count DESC,
                        created_at ASC,
                        id ASC
                ) AS rn
            FROM scored
        )
        SELECT r.id AS dupe_id, k.id AS keeper_id
        FROM ranked r
        JOIN ranked k
          ON k.rn = 1
         AND k.name_key = r.name_key
         AND COALESCE(k.dealership_id, '{_NULL_DEALER}'::uuid)
           = COALESCE(r.dealership_id, '{_NULL_DEALER}'::uuid)
        WHERE r.rn > 1
    """))

    # If any duplicate in the group is customer-scoped, keeper should be too
    # so combined documents stay visible on the same tab.
    conn.execute(text("""
        UPDATE stips_categories AS keeper
        SET scope = 'customer'
        FROM stip_cat_dupes map
        JOIN stips_categories AS dupe ON dupe.id = map.dupe_id
        WHERE keeper.id = map.keeper_id
          AND dupe.scope = 'customer'
          AND keeper.scope IS DISTINCT FROM 'customer'
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

    # Lead-scoped files on a customer-scoped tab would be hidden. Move them.
    conn.execute(text("""
        INSERT INTO customer_stip_documents (
            id, customer_id, stips_category_id, file_name, blob_path,
            content_type, file_size, uploaded_by, uploaded_at
        )
        SELECT
            d.id,
            l.customer_id,
            d.stips_category_id,
            d.file_name,
            d.blob_path,
            d.content_type,
            d.file_size,
            d.uploaded_by,
            d.uploaded_at
        FROM lead_stip_documents d
        JOIN leads l ON l.id = d.lead_id
        JOIN stips_categories c ON c.id = d.stips_category_id
        WHERE c.scope = 'customer'
          AND l.customer_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM customer_stip_documents existing WHERE existing.id = d.id
          )
    """))
    conn.execute(text("""
        DELETE FROM lead_stip_documents d
        USING stips_categories c
        WHERE d.stips_category_id = c.id
          AND c.scope = 'customer'
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

    conn.execute(text("DROP INDEX IF EXISTS uq_stips_categories_dealer_name_scope"))
    idx = conn.execute(text("""
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'uq_stips_categories_dealer_name'
    """)).fetchone()
    if not idx:
        conn.execute(text(f"""
            CREATE UNIQUE INDEX uq_stips_categories_dealer_name
            ON stips_categories (
                COALESCE(dealership_id, '{_NULL_DEALER}'::uuid),
                lower(btrim(name))
            )
        """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP INDEX IF EXISTS uq_stips_categories_dealer_name"))
    conn.execute(text("DROP INDEX IF EXISTS uq_stips_categories_dealer_name_scope"))
