"""Sort duplicate leads by when they arrived again.

Revision ID: bv_lead_last_inbound_at
Revises: bu_follow_up_scheduled_notif
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "bv_lead_last_inbound_at"
down_revision: Union[str, None] = "bu_follow_up_scheduled_notif"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_leads_last_inbound_at", "leads", ["last_inbound_at"])
    # Existing duplicates should surface by the last time a new campaign was linked,
    # not by the original created date.
    op.execute(
        """
        UPDATE leads AS l
        SET last_inbound_at = sub.latest
        FROM (
            SELECT lead_id, MAX(added_at) AS latest
            FROM lead_campaigns
            GROUP BY lead_id
            HAVING COUNT(*) > 1
        ) AS sub
        WHERE l.id = sub.lead_id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_leads_last_inbound_at", table_name="leads")
    op.drop_column("leads", "last_inbound_at")
