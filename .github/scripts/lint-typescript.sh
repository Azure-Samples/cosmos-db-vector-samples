#!/bin/bash

# Lint script for nosql-create-index-typescript sample
# Usage: ./lint-typescript.sh

set -e

SAMPLE_DIR="nosql-create-index-typescript"

echo "🔍 Linting TypeScript sample: $SAMPLE_DIR"

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
echo "📦 Installing dependencies..."
npm install --silent

# Run eslint (if configured)
if grep -q "eslint" package.json; then
    echo "🎨 Running ESLint..."
    npm run lint || true
fi

# Run TypeScript compiler check
echo "🔎 Running TypeScript compiler check..."
npx tsc --noEmit

echo "✅ TypeScript linting complete"
