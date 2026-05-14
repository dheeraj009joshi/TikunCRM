"""Allow same email across different dealerships

Revision ID: aw_multi_dealership_email
Revises: av_job_locks
Create Date: 2026-05-13

Replaces the global unique index on users.email with two partial unique indexes
so the same email can belong to multiple dealerships, while still preventing
duplicates within a single dealership and among super admins (dealership_id NULL).
"""
from typing import Sequence, Union

from alembic import op


revision: str = "aw_multi_dealership_email"
down_revision: Union[str, None] = "av_job_locks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the existing global unique index on email
    op.drop_index("ix_users_email", table_name="users")

    # Recreate as a non-unique functional index for fast case-insensitive lookups
    op.execute(
        "CREATE INDEX ix_users_email ON users (lower(email))"
    )

    # Partial unique: within a dealership, email is unique (case-insensitive)
    op.execute(
        "CREATE UNIQUE INDEX ix_users_email_per_dealership "
        "ON users (lower(email), dealership_id) "
        "WHERE dealership_id IS NOT NULL"
    )

    # Partial unique: super admins (no dealership) must have unique emails
    op.execute(
        "CREATE UNIQUE INDEX ix_users_email_super_admin "
        "ON users (lower(email)) "
        "WHERE dealership_id IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_email_super_admin")
    op.execute("DROP INDEX IF EXISTS ix_users_email_per_dealership")
    op.drop_index("ix_users_email", table_name="users")

    # Restore original global unique index
    op.create_index("ix_users_email", "users", ["email"], unique=True)
