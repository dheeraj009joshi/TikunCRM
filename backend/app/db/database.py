"""
Database configuration and session management

Production runs a single uvicorn worker with a connection pool for low latency.
Set DB_USE_NULL_POOL=true when running multiple workers without PgBouncer.
"""
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


def get_engine_url_and_connect_args():
    """
    Build engine URL and connect_args for asyncpg.
    asyncpg does not accept sslmode/ssl in the URL; passing them causes TypeError.
    Use this for any create_async_engine() that uses settings.database_url (e.g. background tasks).
    """
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

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


def create_app_engine():
    """Create the shared async engine with pooling (or NullPool when configured)."""
    url, connect_args = get_engine_url_and_connect_args()
    common = {
        "echo": False,
        "future": True,
        "connect_args": connect_args,
    }
    if settings.db_use_null_pool:
        return create_async_engine(url, poolclass=NullPool, **common)
    return create_async_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        **common,
    )


_engine_url, _connect_args = get_engine_url_and_connect_args()

engine = create_app_engine()

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


_background_engine = None
_background_session_maker = None


def get_background_session_maker():
    """
    Session maker for long-running background jobs (Google Sheets sync, etc.).
    Uses a separate pool with a longer asyncpg command_timeout so large syncs
    don't hit the 60s API query limit.
    """
    global _background_engine, _background_session_maker
    if _background_session_maker is None:
        url, connect_args = get_engine_url_and_connect_args()
        connect_args = {
            **connect_args,
            "command_timeout": settings.db_background_command_timeout,
        }
        common = {
            "echo": False,
            "future": True,
            "connect_args": connect_args,
        }
        if settings.db_use_null_pool:
            _background_engine = create_async_engine(url, poolclass=NullPool, **common)
        else:
            _background_engine = create_async_engine(
                url,
                pool_size=2,
                max_overflow=2,
                pool_pre_ping=True,
                pool_recycle=1800,
                **common,
            )
        _background_session_maker = async_sessionmaker(
            _background_engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _background_session_maker
