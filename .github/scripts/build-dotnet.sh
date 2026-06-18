#!/bin/bash

# Build script for nosql-create-index-dotnet sample
# Usage: ./build-dotnet.sh

set -e

SAMPLE_DIR="nosql-create-index-dotnet"

echo "🔨 Building .NET sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for .csproj
if [ ! -f "*.csproj" ]; then
    echo "❌ Error: .csproj file not found in $SAMPLE_DIR"
    exit 1
fi

# Check for dotnet
if ! command -v dotnet &> /dev/null; then
    echo "❌ Error: .NET SDK is not installed"
    exit 1
fi

# Restore and build
echo "📦 Restoring .NET dependencies..."
dotnet restore

echo "🏗️  Building .NET project..."
dotnet build --configuration Release --no-restore

echo "✅ .NET sample built successfully"
