import os
import sys
from logging.config import fileConfig
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine, pool

from alembic import context

sys.path.append(os.path.join(os.getcwd()))

from app.core.config import settings
from app.db.database import Base
from app.models import *

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _sync_database_url(raw_url: str) -> str:
    """Use psycopg2 for migrations — avoids asyncpg command_timeout on large data updates."""
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


def run_migrations_offline() -> None:
    url = _sync_database_url(settings.database_url)
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _sync_database_url(settings.database_url)
    connectable = create_engine(
        url,
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": 60, "options": "-c statement_timeout=0"},
    )

    with connectable.connect() as connection:
        connection.execute(
            __import__("sqlalchemy").text("SET statement_timeout TO 0")
        )
        connection.execute(
            __import__("sqlalchemy").text("SET lock_timeout TO 0")
        )
        do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
