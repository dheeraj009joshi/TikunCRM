"""
Backup source database to a local SQL file using pg_dump.

Uses SOURCE_DATABASE_URL if set, otherwise DATABASE_URL.
Output: backend/backups/db_backup_YYYY-MM-DD_HH-MM-SS.sql

Requires: pg_dump on PATH (PostgreSQL client tools).

Usage:
  From backend directory:
    python -m scripts.backup_db_to_file

  Or with explicit source:
    SOURCE_DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/dbname?ssl=require" python -m scripts.backup_db_to_file
"""
import os
import re
import subprocess
import sys
from datetime import datetime
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass


def _url_to_pg_dump_url(url: str) -> str:
    """
    Convert SQLAlchemy-style URL to one suitable for pg_dump (libpq).
    - postgresql+asyncpg:// -> postgresql://
    - ssl=require -> sslmode=require
    """
    if not url or "postgresql" not in url:
        return url
    # Strip asyncpg/driver
    url = re.sub(r"^postgresql\+[a-z0-9]+://", "postgresql://", url, flags=re.IGNORECASE)
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        # libpq uses sslmode, not ssl
        if "ssl" in qs and "sslmode" not in qs:
            qs["sslmode"] = qs.pop("ssl", ["prefer"])
        new_query = urlencode([(k, v[0]) for k, v in qs.items()])
        url = urlunparse(parsed._replace(query=new_query))
    return url


def _run_pg_dump(pg_url: str, out_path: str) -> bool:
    """Run pg_dump; return True on success."""
    parsed = urlparse(pg_url)
    if parsed.scheme != "postgresql":
        print("URL must be postgresql:// (driver already stripped).")
        return False
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    user = parsed.username or os.environ.get("PGUSER", "postgres")
    password = parsed.password
    dbname = (parsed.path or "/").strip("/") or "postgres"
    qs = parse_qs(parsed.query or "")
    sslmode = qs.get("sslmode", ["prefer"])[0]

    env = os.environ.copy()
    if password:
        env["PGPASSWORD"] = password
    if sslmode and sslmode != "disable":
        env["PGSSLMODE"] = sslmode

    cmd = [
        "pg_dump",
        "--host", host,
        "--port", str(port),
        "--username", user,
        "--dbname", dbname,
        "--no-password",
        "--format=plain",
        "--file", out_path,
    ]
    if sslmode and sslmode != "disable":
        cmd.extend(["--no-owner", "--no-acl"])  # avoid role dependency in backup

    try:
        subprocess.run(cmd, env=env, check=True, capture_output=True, text=True)
        return True
    except FileNotFoundError:
        print("pg_dump not found. Install PostgreSQL client tools (e.g. brew install libpq, or postgresql-client).")
        return False
    except subprocess.CalledProcessError as e:
        print("pg_dump failed:", e.stderr or e)
        return False


def main():
    source_url = (
        os.environ.get("SOURCE_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
    )
    if not source_url:
        print("Set SOURCE_DATABASE_URL or DATABASE_URL in .env or environment.")
        sys.exit(1)

    pg_url = _url_to_pg_dump_url(source_url)
    if not pg_url:
        print("Invalid database URL.")
        sys.exit(1)

    backups_dir = os.path.join(_backend_dir, "backups")
    os.makedirs(backups_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_path = os.path.join(backups_dir, f"db_backup_{timestamp}.sql")

    # Mask password in log
    display_url = pg_url
    if "@" in display_url:
        display_url = re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", display_url)
    print(f"Source: {display_url}")
    print(f"Output: {out_path}")

    if not _run_pg_dump(pg_url, out_path):
        sys.exit(1)
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Done. Backup size: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
