#!/bin/bash

# Exit on error
set -e

# Configuration
IMAGE_NAME="increment"
IMAGE_TAG="latest"

echo "Building Docker image for $IMAGE_NAME:$IMAGE_TAG..."

# Run npm build to prepare files
echo "Preparing application files..."
npm run build

# Build the Docker image
echo "Building Docker image..."
docker build -t $IMAGE_NAME:$IMAGE_TAG .

echo "Docker image built successfully!"
echo "You can run the container with: docker run -p 3000:3000 $IMAGE_NAME:$IMAGE_TAG"
echo "Or use docker-compose: docker-compose up -d" 