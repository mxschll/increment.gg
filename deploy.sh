#!/bin/bash

# Exit on error
set -e

echo "Starting deployment..."

# Pull the latest changes
echo "Pulling latest changes..."
git pull

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the application
echo "Building the application..."
npm run build

# Restart the application (if using PM2)
if command -v pm2 &> /dev/null; then
    echo "Restarting the application with PM2..."
    pm2 restart increment || pm2 start src/server.js --name increment
else
    echo "PM2 not found. Please start the application manually."
fi

echo "Deployment completed successfully!" 