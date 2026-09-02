"""
Carvaminos single-org data consolidation (production-safe).

Uses synchronous psycopg2 — no asyncpg 30s command timeout.
Commits after each major step so a retry can resume safely.

Usage (from backend/):
    python -m scripts.carvaminos_consolidation

Then:
    alembic stamp bh_carvaminos
    alembic upgrade head
"""
from __future__ import annotations

import sys
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

CARVAMINOS_ID = "00000000-0000-4000-a000-000000000001"


def _sync_database_url(raw_url: str) -> str:
    url = raw_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        for key in ("ssl", "sslmode", "channel_binding"):
            qs.pop(key, None)
        new_query = urlencode([(k, v[0]) for k, v in qs.items()])
        url = urlunparse(parsed._replace(query=new_query))
    return url


def _disable_timeouts(conn) -> None:
    conn.execute(text("SET statement_timeout TO 0"))
    conn.execute(text("SET lock_timeout TO 0"))


def _commit_step(conn, label: str) -> None:
    conn.commit()
    print(f"✓ {label}")


def _resolve_carvaminos_id(conn) -> str:
    row = conn.execute(
        text("SELECT id FROM dealerships WHERE slug = 'carvaminos'")
    ).fetchone()
    if row:
        return str(row[0])
    conn.execute(
        text("""
            INSERT INTO dealerships
                (id, name, slug, address, city, state, country,
                 phone, email, website, timezone, is_active,
                 config, working_hours, lead_assignment_rules,
                 created_at, updated_at)
            VALUES
                (:id, 'Carvaminos', 'carvaminos', NULL, NULL, NULL, 'US',
                 NULL, NULL, NULL, 'America/Chicago', true,
                 '{}', '{}', '{}', NOW(), NOW())
        """),
        {"id": CARVAMINOS_ID},
    )
    return CARVAMINOS_ID


def _old_dealership_ids(conn, cid: str) -> list[str]:
    rows = conn.execute(
        text("SELECT id FROM dealerships WHERE id != :cid ORDER BY created_at"),
        {"cid": cid},
    ).fetchall()
    return [str(r[0]) for r in rows]


def _repoint_table(
    conn,
    table: str,
    cid: str,
    *,
    column: str = "dealership_id",
    include_null: bool = True,
) -> None:
    """Indexed UPDATE per source dealership — fast on large tables."""
    total = 0
    for old_id in _old_dealership_ids(conn, cid):
        result = conn.execute(
            text(f"UPDATE {table} SET {column} = :cid WHERE {column} = :old_id"),
            {"cid": cid, "old_id": old_id},
        )
        n = result.rowcount or 0
        total += n
        if n:
            print(f"    {table}: {n} rows ← dealership {old_id[:8]}…")
    if include_null:
        result = conn.execute(
            text(f"UPDATE {table} SET {column} = :cid WHERE {column} IS NULL"),
            {"cid": cid},
        )
        n = result.rowcount or 0
        total += n
        if n:
            print(f"    {table}: {n} NULL rows")
    if total:
        print(f"  → {table}.{column}: {total} rows total")


def _consolidate_users(conn, cid: str) -> None:
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

    conn.execute(
        text("""
            UPDATE users SET dealership_id = :cid, updated_at = NOW()
            WHERE is_active = true
              AND (dealership_id IS NULL OR dealership_id != :cid)
        """),
        {"cid": cid},
    )


def _collapse_configs(conn, cid: str) -> None:
    best = conn.execute(text("""
        SELECT id FROM dealership_email_configs
        ORDER BY
            CASE WHEN is_verified = true THEN 0 ELSE 1 END,
            CASE WHEN is_active  = true THEN 0 ELSE 1 END,
            created_at DESC
        LIMIT 1
    """)).fetchone()
    if best:
        keep_id = str(best[0])
        conn.execute(text("DELETE FROM dealership_email_configs WHERE id != :k"), {"k": keep_id})
        conn.execute(
            text("UPDATE dealership_email_configs SET dealership_id = :cid WHERE id = :k"),
            {"cid": cid, "k": keep_id},
        )

    best = conn.execute(text("""
        SELECT id FROM dealership_twilio_configs ORDER BY created_at DESC LIMIT 1
    """)).fetchone()
    if best:
        keep_id = str(best[0])
        conn.execute(text("DELETE FROM dealership_twilio_configs WHERE id != :k"), {"k": keep_id})
        conn.execute(
            text("UPDATE dealership_twilio_configs SET dealership_id = :cid WHERE id = :k"),
            {"cid": cid, "k": keep_id},
        )


def _collapse_auto_whatsapp(conn, cid: str) -> None:
    best = conn.execute(text("""
        SELECT id FROM auto_whatsapp_profiles ORDER BY created_at DESC LIMIT 1
    """)).fetchone()
    if not best:
        return
    keep_id = str(best[0])
    conn.execute(text("""
        DELETE FROM auto_whatsapp_job_logs
        WHERE job_id IN (
            SELECT j.id FROM auto_whatsapp_jobs j
            WHERE j.dealership_id IN (
                SELECT dealership_id FROM auto_whatsapp_profiles WHERE id != :keep_id
            )
        )
    """), {"keep_id": keep_id})
    conn.execute(text("""
        DELETE FROM auto_whatsapp_jobs
        WHERE dealership_id IN (
            SELECT dealership_id FROM auto_whatsapp_profiles WHERE id != :keep_id
        )
    """), {"keep_id": keep_id})
    conn.execute(text("DELETE FROM auto_whatsapp_profiles WHERE id != :keep_id"), {"keep_id": keep_id})
    conn.execute(
        text("UPDATE auto_whatsapp_profiles SET dealership_id = :cid WHERE id = :keep_id"),
        {"cid": cid, "keep_id": keep_id},
    )
    conn.execute(text("UPDATE auto_whatsapp_jobs SET dealership_id = :cid"), {"cid": cid})


def run_consolidation(engine: Engine) -> str:
    from scripts.ensure_partner_schema import ensure_partner_schema

    with engine.connect() as conn:
        _disable_timeouts(conn)

        print("Step 0: Partner schema (prevents API 500)")
        ensure_partner_schema(conn)
        _commit_step(conn, "Partner schema OK")

        print("Step 1: Carvaminos dealership")
        cid = _resolve_carvaminos_id(conn)
        _commit_step(conn, f"Carvaminos id = {cid}")

        print("Step 2: Config tables")
        _collapse_configs(conn, cid)
        _collapse_auto_whatsapp(conn, cid)
        _commit_step(conn, "Configs collapsed")

        print("Step 3: BDC access + users")
        conn.execute(text("DELETE FROM user_dealership_access"))
        _consolidate_users(conn, cid)
        _commit_step(conn, "Users consolidated")

        data_tables = [
            "leads", "activities", "call_logs", "sms_logs",
            "whatsapp_logs", "whatsapp_messages", "whatsapp_bulk_sends",
            "appointments", "tasks", "guests", "email_templates",
            "whatsapp_templates", "whatsapp_connections", "stips_categories",
            "campaign_mappings", "eligibility_criteria", "eligibility_assessment",
            "ai_outbound_calls", "ai_conversations", "lead_credit_applications",
            "showroom_visits",
        ]
        print("Step 4: Repoint data tables (one commit per table)")
        for tbl in data_tables:
            print(f"  {tbl}…")
            _repoint_table(conn, tbl, cid)
            _commit_step(conn, tbl)

        print("Step 5: lead_stages + sync sources")
        for old_id in _old_dealership_ids(conn, cid):
            conn.execute(
                text("UPDATE lead_stages SET dealership_id = :cid WHERE dealership_id = :old_id"),
                {"cid": cid, "old_id": old_id},
            )
        conn.execute(
            text("""
                UPDATE lead_sync_sources SET default_dealership_id = :cid
                WHERE default_dealership_id IS NOT NULL
                  AND default_dealership_id != :cid
            """),
            {"cid": cid},
        )
        _commit_step(conn, "Stages + sync sources")

        print("Step 6: Archive old dealerships")
        conn.execute(
            text("UPDATE dealerships SET is_active = false WHERE id != :cid"),
            {"cid": cid},
        )
        _commit_step(conn, "Old dealerships archived")

        return cid


def main() -> int:
    from app.core.config import settings

    url = _sync_database_url(settings.database_url)
    print(f"Connecting (sync psycopg2)…")
    engine = create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 60, "options": "-c statement_timeout=0"},
    )
    try:
        cid = run_consolidation(engine)
        print(f"\nDone. Carvaminos id = {cid}")
        print("\nNext:")
        print("  alembic stamp bh_carvaminos")
        print("  alembic upgrade head")
        return 0
    except Exception as exc:
        print(f"\nFAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
