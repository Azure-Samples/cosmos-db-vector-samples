#!/bin/bash

# Build script for nosql-create-index-go sample
# Usage: ./build-go.sh

set -e

SAMPLE_DIR="nosql-create-index-go"

echo "🔨 Building Go sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for go.mod
if [ ! -f "go.mod" ]; then
    echo "❌ Error: go.mod not found in $SAMPLE_DIR"
    exit 1
fi

# Download dependencies
echo "📦 Downloading Go dependencies..."
go mod download

# Build the application (compile all .go files in directory)
echo "🏗️  Building application..."
go build -o dist/app .

echo "✅ Go sample built successfully: dist/app"
