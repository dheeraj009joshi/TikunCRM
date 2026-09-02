"""
Database configuration and session management

Azure Postgres has a low connection limit. Holding QueuePool connections (plus a
second background pool) caused intermittent 500s on simple endpoints like
/auth/lookup-dealerships — first request OK, then failures.

Default: NullPool (open per checkout, close when done).
Set DB_USE_NULL_POOL=false only when using PgBouncer / high connection limits.
"""
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


def get_engine_url_and_connect_args():
    """
    Build engine URL and connect_args for asyncpg.
    asyncpg does not accept sslmode/ssl in the URL; passing them causes TypeError.
    """
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

    url = settings.database_url
    use_ssl = "ssl=require" in url or "sslmode=require" in url
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        qs.pop("ssl", None)
        qs.pop("sslmode", None)
        qs.pop("channel_binding", None)
        new_query = urlencode([(k, v[0]) for k, v in qs.items()])
        url = urlunparse(parsed._replace(query=new_query))
    connect_args = {
        "command_timeout": settings.db_command_timeout,
        "timeout": 15,
    }
    if use_ssl:
        connect_args["ssl"] = True
    return url, connect_args


def create_app_engine(*, command_timeout: Optional[int] = None, force_null_pool: bool = False):
    """Create an async engine. NullPool by default to avoid Azure connection exhaustion."""
    url, connect_args = get_engine_url_and_connect_args()
    if command_timeout is not None:
        connect_args = {**connect_args, "command_timeout": command_timeout}
    common = {
        "echo": False,
        "future": True,
        "connect_args": connect_args,
    }
    if force_null_pool or settings.db_use_null_pool:
        return create_async_engine(url, poolclass=NullPool, **common)
    return create_async_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        **common,
    )


engine = create_app_engine()

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


async def create_tables():
    """Create all tables (for development only)"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_tables():
    """Drop all tables (for development only)"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


_background_session_maker = None


def get_background_session_maker():
    """
    Session maker for long-running background jobs (Google Sheets sync, etc.).
    Always NullPool with a longer command_timeout so we never hold a second
    connection pool against Azure while still allowing multi-minute syncs.
    """
    global _background_session_maker
    if _background_session_maker is None:
        bg_engine = create_app_engine(
            command_timeout=settings.db_background_command_timeout,
            force_null_pool=True,
        )
        _background_session_maker = async_sessionmaker(
            bg_engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _background_session_maker
