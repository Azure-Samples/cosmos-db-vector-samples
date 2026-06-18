#!/bin/bash

# Build script for nosql-create-index-typescript sample
# Usage: ./build-typescript.sh

set -e

SAMPLE_DIR="nosql-create-index-typescript"

echo "🔨 Building TypeScript sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for package.json
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found in $SAMPLE_DIR"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    exit 1
fi

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install --silent

# Build TypeScript (compile to dist/)
echo "🏗️  Building TypeScript..."
npx tsc

echo "✅ TypeScript sample built successfully"
