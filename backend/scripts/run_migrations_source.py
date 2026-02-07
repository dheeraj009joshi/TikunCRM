"""
Run Alembic migrations against the SOURCE database (e.g. Azure LeedsCrm).
Use this to bring the source DB schema in line with Neon (same migrations).

Usage (from backend/):
  SOURCE_DATABASE_URL="postgresql+asyncpg://..." python -m scripts.run_migrations_source

Or set SOURCE_DATABASE_URL in .env and run:
  python -m scripts.run_migrations_source
"""
import os
import subprocess
import sys

# Load .env from backend directory
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass

source_url = os.environ.get("SOURCE_DATABASE_URL")
if not source_url:
    print("SOURCE_DATABASE_URL is not set. Set it in .env or pass it when running:")
    print("  SOURCE_DATABASE_URL='postgresql+asyncpg://...' python -m scripts.run_migrations_source")
    sys.exit(1)

# Run alembic with DATABASE_URL pointing at the source DB
env = os.environ.copy()
env["DATABASE_URL"] = source_url

print("Running migrations on SOURCE database...")
result = subprocess.run(
    [sys.executable, "-m", "alembic", "upgrade", "head"],
    cwd=_backend_dir,
    env=env,
)
sys.exit(result.returncode)
