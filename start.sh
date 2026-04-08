#!/bin/bash

echo "=========================================="
echo "  ESXi VM Manager - Web Edition"
echo "=========================================="
echo ""

if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    echo "Please install Docker first:"
    echo "  https://docs.docker.com/engine/install/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Error: Docker Compose is not installed"
    echo "Please install Docker Compose first:"
    echo "  https://docs.docker.com/compose/install/"
    exit 1
fi

echo "Building Docker image..."
docker build -t esxi-vm-manager:latest .

echo ""
echo "Starting container..."
docker compose up -d

echo ""
echo "=========================================="
echo "  ESXi VM Manager is starting!"
echo "=========================================="
echo ""
echo "Access the web interface at:"
echo "  http://localhost:5000"
echo ""
echo "To stop:"
echo "  docker compose down"
echo ""
echo "To view logs:"
echo "  docker compose logs -f"
echo ""
