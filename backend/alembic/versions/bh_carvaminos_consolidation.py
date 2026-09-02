"""Consolidate all data into single Carvaminos organization.

Pivots from multi-dealership tenant model to single-brand Carvaminos.
Creates one Carvaminos dealership and points all existing records to it.
Old dealership rows are archived (is_active=false), NOT deleted.

Zero data loss: no columns or tables are dropped.

Revision ID: bh_carvaminos
Revises: bg_lead_credit_apps
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "bh_carvaminos"
down_revision: Union[str, None] = "bg_lead_credit_apps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CARVAMINOS_ID = "00000000-0000-4000-a000-000000000001"


def _consolidate_users_to_carvaminos(conn, cid: str) -> None:
    """
    Merge users into the single Carvaminos org without violating
    ix_users_email_per_dealership (unique lower(email), dealership_id).
    """
    dup_emails = conn.execute(text("""
        SELECT lower(email) AS em
        FROM users
        GROUP BY lower(email)
        HAVING COUNT(*) > 1
    """)).fetchall()

    for row in dup_emails:
        em = row[0]
        keeper = conn.execute(text("""
            SELECT id FROM users
            WHERE lower(email) = :em
            ORDER BY
                CASE WHEN dealership_id = :cid THEN 0 ELSE 1 END,
                CASE WHEN is_active = true THEN 0 ELSE 1 END,
                last_login_at DESC NULLS LAST,
                created_at DESC
            LIMIT 1
        """), {"em": em, "cid": cid}).fetchone()
        if not keeper:
            continue
        keep_id = str(keeper[0])
        conn.execute(text("""
            UPDATE users
            SET is_active = false, updated_at = NOW()
            WHERE lower(email) = :em AND id != :keep_id
        """), {"em": em, "keep_id": keep_id})
        conn.execute(text("""
            UPDATE users
            SET dealership_id = :cid, updated_at = NOW()
            WHERE id = :keep_id
              AND (dealership_id IS NULL OR dealership_id != :cid)
        """), {"cid": cid, "keep_id": keep_id})

    # Move remaining active users (unique emails) to Carvaminos
    conn.execute(text("""
        UPDATE users
        SET dealership_id = :cid, updated_at = NOW()
        WHERE is_active = true
          AND (dealership_id IS NULL OR dealership_id != :cid)
    """), {"cid": cid})


def upgrade() -> None:
    conn = op.get_bind()

    # ── Step 1: Create Carvaminos dealership ──────────────────────
    existing = conn.execute(
        text("SELECT id FROM dealerships WHERE slug = 'carvaminos'")
    ).fetchone()

    if existing:
        cid = str(existing[0])
    else:
        cid = CARVAMINOS_ID
        conn.execute(text("""
            INSERT INTO dealerships
                (id, name, slug, address, city, state, country,
                 phone, email, website, timezone, is_active,
                 config, working_hours, lead_assignment_rules,
                 created_at, updated_at)
            VALUES
                (:id, 'Carvaminos', 'carvaminos', NULL, NULL, NULL, 'US',
                 NULL, NULL, NULL, 'America/Chicago', true,
                 '{}', '{}', '{}',
                 NOW(), NOW())
        """), {"id": cid})

    # ── Step 2: Handle 1:1 config tables (unique on dealership_id) ─

    # 2a. DealershipEmailConfig — keep the best (verified+active), reassign
    _collapse_email_config(conn, cid)

    # 2b. DealershipTwilioConfig — keep the newest, reassign
    _collapse_twilio_config(conn, cid)

    # 2c. AutoWhatsAppProfiles (NOT NULL + unique dealership_id)
    #     Must delete child jobs/logs first.
    best_profile = conn.execute(text("""
        SELECT id, dealership_id FROM auto_whatsapp_profiles
        ORDER BY created_at DESC LIMIT 1
    """)).fetchone()

    if best_profile:
        keep_profile_id = str(best_profile[0])
        # Delete job logs for jobs belonging to OTHER profiles
        conn.execute(text("""
            DELETE FROM auto_whatsapp_job_logs
            WHERE job_id IN (
                SELECT j.id FROM auto_whatsapp_jobs j
                JOIN auto_whatsapp_profiles p ON p.dealership_id = j.dealership_id
                WHERE p.id != :keep_id
            )
        """), {"keep_id": keep_profile_id})
        # Delete jobs for other profiles
        conn.execute(text("""
            DELETE FROM auto_whatsapp_jobs
            WHERE dealership_id IN (
                SELECT dealership_id FROM auto_whatsapp_profiles
                WHERE id != :keep_id
            )
        """), {"keep_id": keep_profile_id})
        # Delete other profiles
        conn.execute(text(
            "DELETE FROM auto_whatsapp_profiles WHERE id != :keep_id"
        ), {"keep_id": keep_profile_id})
        # Reassign survivor to Carvaminos
        conn.execute(text(
            "UPDATE auto_whatsapp_profiles SET dealership_id = :cid WHERE id = :keep_id"
        ), {"cid": cid, "keep_id": keep_profile_id})
        conn.execute(text(
            "UPDATE auto_whatsapp_jobs SET dealership_id = :cid"
        ), {"cid": cid})

    # ── Step 3: Clean up BDC multi-store junction ─────────────────
    conn.execute(text("DELETE FROM user_dealership_access"))

    # ── Step 4: Consolidate users ─────────────────────────────────
    _consolidate_users_to_carvaminos(conn, cid)

    # ── Step 5: Consolidate all data tables ───────────────────────

    # Tables with nullable dealership_id — point non-NULL to Carvaminos
    nullable_tables = [
        "leads", "activities", "appointments", "call_logs", "sms_logs",
        "whatsapp_logs", "whatsapp_messages", "whatsapp_bulk_sends",
        "tasks", "guests", "email_templates", "whatsapp_templates",
        "whatsapp_connections", "stips_categories", "campaign_mappings",
        "eligibility_criteria", "eligibility_assessment",
        "ai_outbound_calls", "ai_conversations", "lead_credit_applications",
    ]
    for tbl in nullable_tables:
        conn.execute(text(
            f"UPDATE {tbl} SET dealership_id = :cid "
            f"WHERE dealership_id IS NOT NULL AND dealership_id != :cid"
        ), {"cid": cid})

    # Move global-pool leads (NULL dealership_id) into Carvaminos
    conn.execute(text(
        "UPDATE leads SET dealership_id = :cid WHERE dealership_id IS NULL"
    ), {"cid": cid})

    # Also move NULL activities/appointments into Carvaminos
    for tbl in ["activities", "appointments", "tasks", "guests",
                "ai_conversations", "ai_outbound_calls",
                "lead_credit_applications"]:
        conn.execute(text(
            f"UPDATE {tbl} SET dealership_id = :cid WHERE dealership_id IS NULL"
        ), {"cid": cid})

    # showroom_visits has NOT NULL constraint — just reassign
    conn.execute(text(
        "UPDATE showroom_visits SET dealership_id = :cid WHERE dealership_id != :cid"
    ), {"cid": cid})

    # lead_stages: keep NULL rows (global defaults), update per-dealership overrides
    conn.execute(text(
        "UPDATE lead_stages SET dealership_id = :cid "
        "WHERE dealership_id IS NOT NULL AND dealership_id != :cid"
    ), {"cid": cid})

    # lead_sync_sources uses default_dealership_id
    conn.execute(text(
        "UPDATE lead_sync_sources SET default_dealership_id = :cid "
        "WHERE default_dealership_id IS NOT NULL AND default_dealership_id != :cid"
    ), {"cid": cid})

    # ── Step 6: Archive old dealerships ───────────────────────────
    conn.execute(text(
        "UPDATE dealerships SET is_active = false WHERE id != :cid"
    ), {"cid": cid})


def downgrade() -> None:
    # Data migration — old per-dealership associations cannot be auto-restored.
    # Restore from backup if needed.
    pass


def _collapse_email_config(conn, carvaminos_id: str) -> None:
    """Keep one email config row (prefer verified+active), reassign to Carvaminos."""
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
        conn.execute(text(
            "DELETE FROM dealership_email_configs WHERE id != :keep_id"
        ), {"keep_id": keep_id})
        conn.execute(text(
            "UPDATE dealership_email_configs SET dealership_id = :cid WHERE id = :keep_id"
        ), {"cid": carvaminos_id, "keep_id": keep_id})


def _collapse_twilio_config(conn, carvaminos_id: str) -> None:
    """Keep one Twilio config row (prefer newest), reassign to Carvaminos."""
    best = conn.execute(text("""
        SELECT id FROM dealership_twilio_configs
        ORDER BY created_at DESC
        LIMIT 1
    """)).fetchone()

    if best:
        keep_id = str(best[0])
        conn.execute(text(
            "DELETE FROM dealership_twilio_configs WHERE id != :keep_id"
        ), {"keep_id": keep_id})
        conn.execute(text(
            "UPDATE dealership_twilio_configs SET dealership_id = :cid WHERE id = :keep_id"
        ), {"cid": carvaminos_id, "keep_id": keep_id})
