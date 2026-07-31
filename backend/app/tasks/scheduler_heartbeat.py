"""Shared scheduler heartbeat for multi-worker gunicorn status."""
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

SCHEDULER_HEARTBEAT_FILE = Path("/tmp/tikuncrm_scheduler_heartbeat")


def write_scheduler_heartbeat(note: str = "") -> None:
    """Mark that a scheduled job ran recently (readable by all gunicorn workers)."""
    try:
        SCHEDULER_HEARTBEAT_FILE.write_text(
            f"pid={os.getpid()} ts={time.time():.0f} note={note}\n",
            encoding="utf-8",
        )
    except OSError as e:
        logger.warning("Failed to write scheduler heartbeat: %s", e)


def read_scheduler_heartbeat() -> dict:
    """Return heartbeat info if present."""
    try:
        if not SCHEDULER_HEARTBEAT_FILE.exists():
            return {"exists": False, "fresh": False}
        raw = SCHEDULER_HEARTBEAT_FILE.read_text(encoding="utf-8").strip()
        parts = {}
        for token in raw.split():
            if "=" in token:
                k, v = token.split("=", 1)
                parts[k] = v
        ts = float(parts.get("ts", 0) or 0)
        age = (time.time() - ts) if ts else None
        return {
            "exists": True,
            "raw": raw,
            "pid": parts.get("pid"),
            "note": parts.get("note"),
            "age_seconds": age,
            "fresh": age is not None and age < 600,
        }
    except Exception as e:
        return {"exists": False, "fresh": False, "error": str(e)}
