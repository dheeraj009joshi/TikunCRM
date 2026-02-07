"""Add parent_id to activities for note reply threading

Revision ID: r5678901234o
Revises: q4567890123n
Create Date: 2026-02-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import inspect

revision = 'r5678901234o'
down_revision = 'q4567890123n'
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    insp = inspect(conn)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def _constraint_exists(conn, table: str, name: str) -> bool:
    insp = inspect(conn)
    for fk in insp.get_foreign_keys(table):
        if fk.get("name") == name:
            return True
    return False


def _index_exists(conn, table: str, index_name: str) -> bool:
    insp = inspect(conn)
    for idx in insp.get_indexes(table):
        if idx.get("name") == index_name:
            return True
    return False


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "activities", "parent_id"):
        op.add_column(
            'activities',
            sa.Column('parent_id', postgresql.UUID(as_uuid=True), nullable=True)
        )
    if not _constraint_exists(conn, "activities", "fk_activities_parent_id_activities"):
        op.create_foreign_key(
            'fk_activities_parent_id_activities',
            'activities',
            'activities',
            ['parent_id'],
            ['id'],
            ondelete='CASCADE'
        )
    if not _index_exists(conn, "activities", "ix_activities_parent_id"):
        op.create_index(
            op.f('ix_activities_parent_id'),
            'activities',
            ['parent_id'],
            unique=False
        )


def downgrade() -> None:
    op.drop_index(op.f('ix_activities_parent_id'), table_name='activities')
    op.drop_constraint('fk_activities_parent_id_activities', 'activities', type_='foreignkey')
    op.drop_column('activities', 'parent_id')
