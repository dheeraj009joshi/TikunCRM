"""
Backup ALL databases from an Azure PostgreSQL server.

This script:
1. Connects to the server and lists all databases
2. Backs up each database individually using pg_dump
3. Optionally backs up global objects (roles) using pg_dumpall --globals-only
4. Compresses backups with gzip to save space
5. Creates a timestamped backup folder

Output: backend/backups/full_backup_YYYY-MM-DD_HH-MM-SS/
  - globals.sql.gz (roles and tablespaces)
  - <database_name>.sql.gz (for each database)

Requires: pg_dump, pg_dumpall, psql on PATH (PostgreSQL client tools).

Usage:
  From backend directory:
    python -m scripts.backup_all_databases

  Or with explicit connection:
    python -m scripts.backup_all_databases --host mindsurvey.postgres.database.azure.com --user mindsurvey --password Dheeraj2006

  Or using DATABASE_URL:
    DATABASE_URL="postgresql+asyncpg://user:pass@host:5432" python -m scripts.backup_all_databases
"""
import argparse
import gzip
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass


SYSTEM_DATABASES = {"template0", "template1", "azure_maintenance", "azure_sys"}


def parse_database_url(url: str) -> dict:
    """Parse SQLAlchemy-style database URL into components."""
    if not url:
        return {}
    
    url = re.sub(r"^postgresql\+[a-z0-9]+://", "postgresql://", url, flags=re.IGNORECASE)
    parsed = urlparse(url)
    
    qs = parse_qs(parsed.query or "")
    sslmode = qs.get("sslmode", qs.get("ssl", ["require"]))[0]
    
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "database": (parsed.path or "/").strip("/") or "postgres",
        "sslmode": sslmode,
    }


def get_pg_env(conn: dict) -> dict:
    """Create environment dict for pg_* commands."""
    env = os.environ.copy()
    if conn.get("password"):
        env["PGPASSWORD"] = conn["password"]
    if conn.get("sslmode") and conn["sslmode"] != "disable":
        env["PGSSLMODE"] = conn["sslmode"]
    return env


def list_databases(conn: dict) -> list[str]:
    """List all databases on the server (excluding system databases)."""
    env = get_pg_env(conn)
    
    cmd = [
        "psql",
        "--host", conn["host"],
        "--port", str(conn["port"]),
        "--username", conn["user"],
        "--dbname", "postgres",
        "--no-password",
        "--tuples-only",
        "--no-align",
        "-c", "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;"
    ]
    
    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, check=True)
        databases = [db.strip() for db in result.stdout.strip().split("\n") if db.strip()]
        databases = [db for db in databases if db not in SYSTEM_DATABASES]
        return databases
    except FileNotFoundError:
        print("ERROR: psql not found. Install PostgreSQL client tools.")
        print("  macOS: brew install libpq && brew link --force libpq")
        print("  Ubuntu/Debian: sudo apt-get install postgresql-client")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Failed to list databases: {e.stderr}")
        sys.exit(1)


def backup_globals(conn: dict, output_path: str) -> bool:
    """Backup global objects (roles, tablespaces) using pg_dumpall."""
    env = get_pg_env(conn)
    
    cmd = [
        "pg_dumpall",
        "--host", conn["host"],
        "--port", str(conn["port"]),
        "--username", conn["user"],
        "--no-password",
        "--globals-only",
        "--no-role-passwords",  # Azure doesn't allow dumping role passwords
    ]
    
    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, check=True)
        with gzip.open(output_path, "wt", encoding="utf-8") as f:
            f.write(result.stdout)
        return True
    except FileNotFoundError:
        print("WARNING: pg_dumpall not found. Skipping globals backup.")
        return False
    except subprocess.CalledProcessError as e:
        print(f"WARNING: Failed to backup globals: {e.stderr}")
        return False


def backup_database(conn: dict, database: str, output_path: str) -> bool:
    """Backup a single database using pg_dump."""
    env = get_pg_env(conn)
    
    cmd = [
        "pg_dump",
        "--host", conn["host"],
        "--port", str(conn["port"]),
        "--username", conn["user"],
        "--dbname", database,
        "--no-password",
        "--format=plain",
        "--no-owner",
        "--no-acl",
        "--verbose",
    ]
    
    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, check=True)
        with gzip.open(output_path, "wt", encoding="utf-8") as f:
            f.write(result.stdout)
        return True
    except FileNotFoundError:
        print("ERROR: pg_dump not found. Install PostgreSQL client tools.")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"  ERROR: {e.stderr}")
        return False


def format_size(size_bytes: int) -> str:
    """Format size in human-readable format."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.2f} TB"


def main():
    parser = argparse.ArgumentParser(description="Backup all databases from PostgreSQL server")
    parser.add_argument("--host", help="Database host")
    parser.add_argument("--port", type=int, default=5432, help="Database port (default: 5432)")
    parser.add_argument("--user", help="Database user")
    parser.add_argument("--password", help="Database password")
    parser.add_argument("--sslmode", default="require", help="SSL mode (default: require)")
    parser.add_argument("--output-dir", help="Output directory (default: backend/backups)")
    parser.add_argument("--no-compress", action="store_true", help="Don't compress backup files")
    args = parser.parse_args()

    # Get connection info from args or DATABASE_URL
    if args.host and args.user:
        conn = {
            "host": args.host,
            "port": args.port,
            "user": args.user,
            "password": args.password or "",
            "sslmode": args.sslmode,
        }
    else:
        db_url = os.environ.get("SOURCE_DATABASE_URL") or os.environ.get("DATABASE_URL")
        if not db_url:
            print("ERROR: Provide --host/--user or set DATABASE_URL environment variable.")
            print("\nUsage examples:")
            print("  python -m scripts.backup_all_databases --host your-server.postgres.database.azure.com --user admin --password secret")
            print("  DATABASE_URL='postgresql://user:pass@host:5432' python -m scripts.backup_all_databases")
            sys.exit(1)
        conn = parse_database_url(db_url)

    # Create backup directory
    output_base = args.output_dir or os.path.join(_backend_dir, "backups")
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_dir = os.path.join(output_base, f"full_backup_{timestamp}")
    os.makedirs(backup_dir, exist_ok=True)

    # Mask password in display
    masked_conn = f"{conn['user']}:***@{conn['host']}:{conn['port']}"
    print("=" * 60)
    print("PostgreSQL Full Server Backup")
    print("=" * 60)
    print(f"Server: {masked_conn}")
    print(f"SSL Mode: {conn.get('sslmode', 'require')}")
    print(f"Output: {backup_dir}")
    print("=" * 60)

    # List databases
    print("\nDiscovering databases...")
    databases = list_databases(conn)
    
    if not databases:
        print("No databases found to backup.")
        sys.exit(0)
    
    print(f"Found {len(databases)} database(s): {', '.join(databases)}")
    
    # Backup globals
    print("\n[1/{}] Backing up global objects (roles)...".format(len(databases) + 1))
    ext = ".sql" if args.no_compress else ".sql.gz"
    globals_path = os.path.join(backup_dir, f"globals{ext}")
    if backup_globals(conn, globals_path):
        size = os.path.getsize(globals_path)
        print(f"  Saved: globals{ext} ({format_size(size)})")
    
    # Backup each database
    total_size = 0
    success_count = 0
    failed = []
    
    for i, db in enumerate(databases, start=2):
        print(f"\n[{i}/{len(databases) + 1}] Backing up database '{db}'...")
        db_path = os.path.join(backup_dir, f"{db}{ext}")
        
        if backup_database(conn, db, db_path):
            size = os.path.getsize(db_path)
            total_size += size
            success_count += 1
            print(f"  Saved: {db}{ext} ({format_size(size)})")
        else:
            failed.append(db)

    # Summary
    print("\n" + "=" * 60)
    print("Backup Complete!")
    print("=" * 60)
    print(f"Location: {backup_dir}")
    print(f"Databases backed up: {success_count}/{len(databases)}")
    if failed:
        print(f"Failed: {', '.join(failed)}")
    
    # Calculate total size of backup folder
    total_backup_size = sum(
        os.path.getsize(os.path.join(backup_dir, f))
        for f in os.listdir(backup_dir)
    )
    print(f"Total backup size: {format_size(total_backup_size)}")
    
    # Create manifest file
    manifest_path = os.path.join(backup_dir, "MANIFEST.txt")
    with open(manifest_path, "w") as f:
        f.write(f"Backup created: {datetime.now().isoformat()}\n")
        f.write(f"Server: {conn['host']}:{conn['port']}\n")
        f.write(f"User: {conn['user']}\n")
        f.write(f"Databases: {len(databases)}\n")
        f.write(f"Successful: {success_count}\n")
        f.write(f"Failed: {len(failed)}\n")
        f.write("\nFiles:\n")
        for filename in sorted(os.listdir(backup_dir)):
            filepath = os.path.join(backup_dir, filename)
            size = os.path.getsize(filepath)
            f.write(f"  {filename}: {format_size(size)}\n")
    
    print(f"\nManifest saved to: {manifest_path}")
    
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
