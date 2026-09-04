"""Add partner_store_id to appointments + seed Toyota/Ford partners

Revision ID: bn_appointment_partner
Revises: bm_campaign_targeting
Create Date: 2026-09-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "bn_appointment_partner"
down_revision: Union[str, None] = "bm_campaign_targeting"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TOYOTA_SOUTH_ATLANTA_ID = "00000000-0000-4000-b000-000000000001"
FORD_ATLANTA_ID = "00000000-0000-4000-b000-000000000002"


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE appointments "
            "ADD COLUMN IF NOT EXISTS partner_store_id UUID"
        )
    )
    # FK + index (idempotent-ish)
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'fk_appointments_partner_store'
                ) THEN
                    ALTER TABLE appointments
                    ADD CONSTRAINT fk_appointments_partner_store
                    FOREIGN KEY (partner_store_id)
                    REFERENCES partner_stores(id)
                    ON DELETE SET NULL;
                END IF;
            END $$;
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE INDEX IF NOT EXISTS ix_appointments_partner_store_id
            ON appointments (partner_store_id)
            """
        )
    )

    # Seed the two primary partners used when booking appointments
    op.execute(
        sa.text(
            f"""
            INSERT INTO partner_stores (id, name, brand, city, state, country, is_active, created_at, updated_at)
            VALUES
              ('{TOYOTA_SOUTH_ATLANTA_ID}'::uuid, 'Toyota South Atlanta', 'Toyota', 'Atlanta', 'GA', 'US', true, NOW(), NOW()),
              ('{FORD_ATLANTA_ID}'::uuid, 'Ford Atlanta', 'Ford', 'Atlanta', 'GA', 'US', true, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              brand = EXCLUDED.brand,
              is_active = true,
              updated_at = NOW()
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_appointments_partner_store_id"))
    op.execute(
        sa.text(
            """
            ALTER TABLE appointments
            DROP CONSTRAINT IF EXISTS fk_appointments_partner_store
            """
        )
    )
    op.execute(sa.text("ALTER TABLE appointments DROP COLUMN IF EXISTS partner_store_id"))
