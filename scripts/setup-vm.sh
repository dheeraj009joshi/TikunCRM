#!/bin/bash

# TikunCRM VM Setup Script
# Run this script on a fresh Azure VM (Ubuntu 22.04 recommended)

set -e

echo "=========================================="
echo "TikunCRM VM Setup Script"
echo "=========================================="

# Update system
echo "Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install required packages
echo "Installing required packages..."
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    ufw

# Install Docker
echo "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker $USER
    echo "Docker installed successfully!"
else
    echo "Docker already installed"
fi

# Install Docker Compose
echo "Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "Docker Compose installed successfully!"
else
    echo "Docker Compose already installed"
fi

# Configure firewall
echo "Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Create app directory
APP_DIR="/opt/tikuncrm"
echo "Creating application directory at $APP_DIR..."
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Clone repository
echo "Cloning repository..."
if [ ! -d "$APP_DIR/.git" ]; then
    git clone https://github.com/dheeraj009joshi/TikunCRM.git $APP_DIR
else
    echo "Repository already exists"
fi

cd $APP_DIR

# Create environment file template
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env template..."
    cat > $APP_DIR/.env << 'EOF'
# Database
POSTGRES_USER=tikuncrm
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=tikuncrm
DATABASE_URL=postgresql+asyncpg://tikuncrm:your_secure_password_here@db:5432/tikuncrm

# Redis
REDIS_URL=redis://redis:6379

# Security
SECRET_KEY=your_secret_key_here_generate_with_openssl_rand_hex_32

# CORS
CORS_ORIGINS=https://tikuncrm.com,https://www.tikuncrm.com

# Frontend URLs
NEXT_PUBLIC_API_URL=https://api.tikuncrm.com/api/v1
NEXT_PUBLIC_WS_URL=wss://api.tikuncrm.com
NEXT_PUBLIC_APP_URL=https://tikuncrm.com

# Twilio (for SMS/Calls)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=your_twilio_phone

# SendGrid (for Email)
SENDGRID_API_KEY=your_sendgrid_api_key

# Firebase (for Push Notifications)
FIREBASE_CREDENTIALS={"type":"service_account",...}

# AWS S3 (for file uploads)
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
S3_BUCKET_NAME=tikuncrm-uploads
EOF
    echo "⚠️  Please edit $APP_DIR/.env with your actual credentials!"
fi

# Create SSL certificate directories
mkdir -p certbot/www certbot/conf

echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit $APP_DIR/.env with your credentials"
echo "2. Update nginx/nginx.conf with your domain"
echo "3. Run: docker compose -f docker-compose.prod.yml up -d"
echo "4. Setup SSL: See scripts/setup-ssl.sh"
echo ""
echo "Don't forget to log out and back in for Docker group to take effect!"
