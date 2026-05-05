#!/bin/bash

# TikunCRM SSL Setup Script
# Run this after the VM is set up and DNS is pointing to the server

set -e

DOMAIN=${1:-tikuncrm.com}
EMAIL=${2:-admin@tikuncrm.com}

echo "=========================================="
echo "SSL Certificate Setup for $DOMAIN"
echo "=========================================="

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "Please run with sudo"
    exit 1
fi

APP_DIR="/opt/tikuncrm"
cd $APP_DIR

# Create a temporary nginx config for certificate generation
echo "Creating temporary nginx config for certbot..."
cat > nginx/nginx-certbot.conf << EOF
events {
    worker_connections 1024;
}

http {
    server {
        listen 80;
        server_name $DOMAIN www.$DOMAIN api.$DOMAIN;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 200 'TikunCRM - Setting up SSL...';
            add_header Content-Type text/plain;
        }
    }
}
EOF

# Start nginx with temporary config
echo "Starting nginx for certificate generation..."
docker run -d --name nginx-certbot \
    -p 80:80 \
    -v $APP_DIR/nginx/nginx-certbot.conf:/etc/nginx/nginx.conf:ro \
    -v $APP_DIR/certbot/www:/var/www/certbot \
    nginx:alpine

# Wait for nginx to start
sleep 5

# Generate SSL certificate
echo "Generating SSL certificate..."
docker run --rm \
    -v $APP_DIR/certbot/www:/var/www/certbot \
    -v $APP_DIR/certbot/conf:/etc/letsencrypt \
    certbot/certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN \
    -d www.$DOMAIN \
    -d api.$DOMAIN

# Stop temporary nginx
echo "Stopping temporary nginx..."
docker stop nginx-certbot
docker rm nginx-certbot

# Remove temporary config
rm nginx/nginx-certbot.conf

# Update nginx config with correct domain
echo "Updating nginx configuration..."
sed -i "s/tikuncrm.com/$DOMAIN/g" nginx/nginx.conf

echo "=========================================="
echo "SSL Setup Complete!"
echo "=========================================="
echo ""
echo "Certificate files are in: $APP_DIR/certbot/conf/live/$DOMAIN/"
echo ""
echo "Start the application with:"
echo "  docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "Certificate will auto-renew via the certbot container."
