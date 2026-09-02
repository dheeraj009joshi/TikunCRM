"""Simplify roles for single-org Carvaminos model.

Merges DEALERSHIP_OWNER into DEALERSHIP_ADMIN (functionally identical now).
Aligns NULL dealership_id users to Carvaminos with email dedup (safe after consolidation script).

Revision ID: bj_simplify_roles
Revises: bi_partner_stores
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bj_simplify_roles"
down_revision: Union[str, None] = "bi_partner_stores"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CARVAMINOS_ID = "00000000-0000-4000-a000-000000000001"


def _dedupe_users_per_email(conn, cid: str) -> None:
    """Deactivate duplicate accounts; keep one per email (prefer already at Carvaminos)."""
    dup_emails = conn.execute(text("""
        SELECT lower(email) AS em FROM users
        GROUP BY lower(email) HAVING COUNT(*) > 1
    """)).fetchall()

    for row in dup_emails:
        em = row[0]
        keeper = conn.execute(
            text("""
                SELECT id FROM users WHERE lower(email) = :em
                ORDER BY
                    CASE WHEN dealership_id = :cid THEN 0 ELSE 1 END,
                    CASE WHEN is_active = true THEN 0 ELSE 1 END,
                    last_login_at DESC NULLS LAST,
                    created_at DESC
                LIMIT 1
            """),
            {"em": em, "cid": cid},
        ).fetchone()
        if not keeper:
            continue
        keep_id = str(keeper[0])
        conn.execute(
            text("""
                UPDATE users SET is_active = false, updated_at = NOW()
                WHERE lower(email) = :em AND id != :keep_id
            """),
            {"em": em, "keep_id": keep_id},
        )
        conn.execute(
            text("""
                UPDATE users SET dealership_id = :cid, updated_at = NOW()
                WHERE id = :keep_id
                  AND (dealership_id IS NULL OR dealership_id != :cid)
            """),
            {"cid": cid, "keep_id": keep_id},
        )


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("SET statement_timeout TO 0"))

    row = conn.execute(
        text("SELECT id FROM dealerships WHERE slug = 'carvaminos' AND is_active = true")
    ).fetchone()
    cid = str(row[0]) if row else CARVAMINOS_ID

    conn.execute(text("""
        UPDATE users SET role = 'DEALERSHIP_ADMIN', updated_at = NOW()
        WHERE role = 'DEALERSHIP_OWNER'
    """))

    _dedupe_users_per_email(conn, cid)

    # Only move active users; skip if another row already owns this email at Carvaminos
    conn.execute(
        text("""
            UPDATE users AS u
            SET dealership_id = :cid, updated_at = NOW()
            WHERE u.is_active = true
              AND (u.dealership_id IS NULL OR u.dealership_id != :cid)
              AND NOT EXISTS (
                  SELECT 1 FROM users AS u2
                  WHERE lower(u2.email) = lower(u.email)
                    AND u2.dealership_id = :cid
                    AND u2.id != u.id
                    AND u2.is_active = true
              )
        """),
        {"cid": cid},
    )


def downgrade() -> None:
    pass
