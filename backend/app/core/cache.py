"""
Lightweight async TTL cache for dashboard/report endpoints.

Uses Redis when ``settings.redis_url`` is configured (shared across workers),
otherwise falls back to an in-process dict cache — correct for a single
uvicorn worker and harmless for multiple (each worker keeps its own copy).

Values must be JSON-serializable (dicts/lists of primitives). Endpoints cache
``model_dump()`` output and let FastAPI re-validate through ``response_model``.
"""
import json
import time
from typing import Any, Optional

from app.core.config import settings


class _MemoryBackend:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}

    async def get(self, key: str) -> Optional[str]:
        item = self._store.get(key)
        if item is None:
            return None
        expires_at, payload = item
        if time.monotonic() >= expires_at:
            self._store.pop(key, None)
            return None
        return payload

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        # Opportunistic cleanup to keep the dict bounded
        if len(self._store) > 2048:
            now = time.monotonic()
            for k in [k for k, (exp, _) in self._store.items() if exp <= now]:
                self._store.pop(k, None)
        self._store[key] = (time.monotonic() + ttl_seconds, value)

    async def delete_prefix(self, prefix: str) -> None:
        for k in [k for k in self._store if k.startswith(prefix)]:
            self._store.pop(k, None)


class _RedisBackend:
    def __init__(self, url: str) -> None:
        import redis.asyncio as aioredis  # lazy import; only needed when configured

        self._redis = aioredis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> Optional[str]:
        try:
            return await self._redis.get(key)
        except Exception:
            return None

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        try:
            await self._redis.set(key, value, ex=ttl_seconds)
        except Exception:
            pass

    async def delete_prefix(self, prefix: str) -> None:
        try:
            async for key in self._redis.scan_iter(f"{prefix}*"):
                await self._redis.delete(key)
        except Exception:
            pass


def _build_backend():
    if settings.redis_url:
        try:
            return _RedisBackend(settings.redis_url)
        except Exception:
            pass
    return _MemoryBackend()


_backend = _build_backend()


async def cache_get(key: str) -> Optional[Any]:
    """Return the cached JSON value for key, or None if absent/expired."""
    payload = await _backend.get(key)
    if payload is None:
        return None
    try:
        return json.loads(payload)
    except (TypeError, ValueError):
        return None


async def cache_set(key: str, value: Any, ttl_seconds: int = 60) -> None:
    """Cache a JSON-serializable value with a TTL."""
    try:
        payload = json.dumps(value, default=str)
    except (TypeError, ValueError):
        return
    await _backend.set(key, payload, ttl_seconds)


async def cache_invalidate_prefix(prefix: str) -> None:
    """Drop all keys starting with prefix (e.g. after bulk imports)."""
    await _backend.delete_prefix(prefix)
