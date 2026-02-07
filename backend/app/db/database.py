"""
Database configuration and session management

NOTE: When running with multiple workers (uvicorn --workers N), each worker
gets its own copy of the engine. Using NullPool prevents connection exhaustion
by creating connections on-demand and closing them immediately after use.

Connection timeouts are set to prevent stuck transactions from blocking the database.
"""
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


def _database_url_and_connect_args():
    """Build engine URL and connect_args. asyncpg does not accept sslmode in the URL."""
    url = settings.database_url
    use_ssl = "ssl=require" in url or "sslmode=require" in url
    # Strip ssl params so they are not passed to asyncpg.connect() (causes TypeError)
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        qs.pop("ssl", None)
        qs.pop("sslmode", None)
        qs.pop("channel_binding", None)
        new_query = urlencode([(k, v[0]) for k, v in qs.items()])
        url = urlunparse(parsed._replace(query=new_query))
    connect_args = {
        "command_timeout": 30,
        "timeout": 15,
    }
    if use_ssl:
        connect_args["ssl"] = True
    return url, connect_args


_engine_url, _connect_args = _database_url_and_connect_args()

# Create async engine with NullPool for multi-worker compatibility
# NullPool creates connections on-demand and closes them immediately after use
# This prevents connection exhaustion when running with multiple workers
engine = create_async_engine(
    _engine_url,
    echo=False,  # Disable SQL logging for better performance
    future=True,
    poolclass=NullPool,  # Each query gets a fresh connection - works with multi-worker
    connect_args=_connect_args,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all database models"""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting database session"""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    """Create all tables (for development only)"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_tables():
    """Drop all tables (for development only)"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
