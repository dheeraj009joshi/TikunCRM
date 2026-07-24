#!/bin/bash
#
# Backup all databases from Azure PostgreSQL server
#
# Usage:
#   ./scripts/backup-azure-db.sh
#   ./scripts/backup-azure-db.sh --output /path/to/backups
#   ./scripts/backup-azure-db.sh --keep 7  # Keep last 7 backups, delete older
#
# Environment variables (or set below):
#   DB_HOST - Database host
#   DB_PORT - Database port (default: 5432)
#   DB_USER - Database user
#   DB_PASSWORD - Database password
#   DB_SSLMODE - SSL mode (default: require)
#

set -e

# Configuration - set via environment variables
DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_SSLMODE="${DB_SSLMODE:-require}"

# Defaults
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_ROOT}/backend/backups"
KEEP_BACKUPS=0  # 0 = keep all

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --keep)
            KEEP_BACKUPS="$2"
            shift 2
            ;;
        --host)
            DB_HOST="$2"
            shift 2
            ;;
        --user)
            DB_USER="$2"
            shift 2
            ;;
        --password)
            DB_PASSWORD="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --output DIR    Output directory (default: backend/backups)"
            echo "  --keep N        Keep only last N backups (default: keep all)"
            echo "  --host HOST     Database host"
            echo "  --user USER     Database user"
            echo "  --password PWD  Database password"
            echo "  -h, --help      Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required configuration
if [[ -z "$DB_HOST" || -z "$DB_USER" ]]; then
    echo "ERROR: DB_HOST and DB_USER must be set."
    echo ""
    echo "Set environment variables:"
    echo "  export DB_HOST=your-server.postgres.database.azure.com"
    echo "  export DB_USER=your-username"
    echo "  export DB_PASSWORD=your-password"
    echo ""
    echo "Or use command-line arguments:"
    echo "  $0 --host your-server.postgres.database.azure.com --user your-username --password your-password"
    exit 1
fi

# Check for required tools
for cmd in psql pg_dump pg_dumpall gzip; do
    if ! command -v $cmd &> /dev/null; then
        echo "ERROR: $cmd is not installed."
        echo ""
        echo "Install PostgreSQL client tools:"
        echo "  macOS: brew install libpq && brew link --force libpq"
        echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
        exit 1
    fi
done

# Create backup directory with timestamp
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_DIR="${OUTPUT_DIR}/full_backup_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

# Export password for pg_* tools
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="$DB_SSLMODE"

echo "============================================================"
echo "PostgreSQL Full Server Backup"
echo "============================================================"
echo "Server: ${DB_USER}:***@${DB_HOST}:${DB_PORT}"
echo "SSL Mode: ${DB_SSLMODE}"
echo "Output: ${BACKUP_DIR}"
echo "============================================================"

# Get list of databases (excluding system databases)
echo ""
echo "Discovering databases..."
DATABASES=$(psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="postgres" \
    --no-password \
    --tuples-only \
    --no-align \
    -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('template0', 'template1', 'azure_maintenance', 'azure_sys') ORDER BY datname;")

DB_COUNT=$(echo "$DATABASES" | grep -c . || echo "0")
echo "Found $DB_COUNT database(s)"

# Backup globals (roles)
echo ""
echo "[1/$((DB_COUNT + 1))] Backing up global objects (roles)..."
pg_dumpall \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --no-password \
    --globals-only \
    --no-role-passwords 2>/dev/null | gzip > "${BACKUP_DIR}/globals.sql.gz" || true

if [[ -f "${BACKUP_DIR}/globals.sql.gz" ]]; then
    SIZE=$(du -h "${BACKUP_DIR}/globals.sql.gz" | cut -f1)
    echo "  Saved: globals.sql.gz (${SIZE})"
fi

# Backup each database
SUCCESS_COUNT=0
FAILED=""
COUNTER=2

for DB in $DATABASES; do
    if [[ -z "$DB" ]]; then
        continue
    fi
    
    echo ""
    echo "[${COUNTER}/$((DB_COUNT + 1))] Backing up database '${DB}'..."
    
    if pg_dump \
        --host="$DB_HOST" \
        --port="$DB_PORT" \
        --username="$DB_USER" \
        --dbname="$DB" \
        --no-password \
        --format=plain \
        --no-owner \
        --no-acl 2>/dev/null | gzip > "${BACKUP_DIR}/${DB}.sql.gz"; then
        
        SIZE=$(du -h "${BACKUP_DIR}/${DB}.sql.gz" | cut -f1)
        echo "  Saved: ${DB}.sql.gz (${SIZE})"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "  ERROR: Failed to backup ${DB}"
        FAILED="${FAILED} ${DB}"
        rm -f "${BACKUP_DIR}/${DB}.sql.gz"
    fi
    
    COUNTER=$((COUNTER + 1))
done

# Create manifest
MANIFEST="${BACKUP_DIR}/MANIFEST.txt"
{
    echo "Backup created: $(date -Iseconds)"
    echo "Server: ${DB_HOST}:${DB_PORT}"
    echo "User: ${DB_USER}"
    echo "Databases: ${DB_COUNT}"
    echo "Successful: ${SUCCESS_COUNT}"
    echo "Failed: $(echo "$FAILED" | wc -w | tr -d ' ')"
    echo ""
    echo "Files:"
    for f in "${BACKUP_DIR}"/*; do
        SIZE=$(du -h "$f" | cut -f1)
        echo "  $(basename "$f"): ${SIZE}"
    done
} > "$MANIFEST"

# Calculate total size
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

# Summary
echo ""
echo "============================================================"
echo "Backup Complete!"
echo "============================================================"
echo "Location: ${BACKUP_DIR}"
echo "Databases backed up: ${SUCCESS_COUNT}/${DB_COUNT}"
if [[ -n "$FAILED" ]]; then
    echo "Failed:${FAILED}"
fi
echo "Total backup size: ${TOTAL_SIZE}"
echo ""
echo "Manifest saved to: ${MANIFEST}"

# Cleanup old backups if --keep was specified
if [[ $KEEP_BACKUPS -gt 0 ]]; then
    echo ""
    echo "Cleaning up old backups (keeping last ${KEEP_BACKUPS})..."
    
    # List backup directories sorted by date, skip the newest N
    OLD_BACKUPS=$(ls -1dt "${OUTPUT_DIR}"/full_backup_* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)))
    
    if [[ -n "$OLD_BACKUPS" ]]; then
        echo "$OLD_BACKUPS" | while read -r dir; do
            echo "  Removing: $(basename "$dir")"
            rm -rf "$dir"
        done
    else
        echo "  No old backups to remove."
    fi
fi

# Exit with error if any databases failed
if [[ -n "$FAILED" ]]; then
    exit 1
fi

echo ""
echo "Done!"
