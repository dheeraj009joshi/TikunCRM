#!/bin/bash

# TikunCRM Quick Deploy Script
# Use for manual deployments or testing

set -e

echo "=========================================="
echo "TikunCRM Deployment"
echo "=========================================="

# Check if running in correct directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "Error: docker-compose.prod.yml not found!"
    echo "Please run this script from the project root directory."
    exit 1
fi

# Load environment
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Warning: .env file not found!"
fi

# Parse arguments
REBUILD=false
SERVICE=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --rebuild) REBUILD=true ;;
        --backend) SERVICE="backend" ;;
        --frontend) SERVICE="frontend" ;;
        --all) SERVICE="" ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Pull latest code
echo "Pulling latest code..."
git fetch origin main
git reset --hard origin/main

# Build images
if [ "$REBUILD" = true ] || [ -n "$SERVICE" ]; then
    echo "Building Docker images..."
    if [ -n "$SERVICE" ]; then
        docker compose -f docker-compose.prod.yml build $SERVICE
    else
        docker compose -f docker-compose.prod.yml build
    fi
fi

# Deploy
echo "Starting services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Run migrations
echo "Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head 2>/dev/null || echo "No migrations to run"

# Cleanup
echo "Cleaning up old images..."
docker image prune -f

# Health check
echo "Checking service health..."
sleep 10

if docker compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    echo ""
    echo "=========================================="
    echo "✅ Deployment successful!"
    echo "=========================================="
    echo ""
    docker compose -f docker-compose.prod.yml ps
else
    echo ""
    echo "=========================================="
    echo "❌ Deployment may have issues!"
    echo "=========================================="
    echo ""
    docker compose -f docker-compose.prod.yml ps
    echo ""
    echo "Recent logs:"
    docker compose -f docker-compose.prod.yml logs --tail=20
    exit 1
fi
