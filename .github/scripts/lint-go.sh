#!/bin/bash

# Lint script for nosql-create-index-go sample
# Usage: ./lint-go.sh

set -e

SAMPLE_DIR="nosql-create-index-go"

echo "🔍 Linting Go sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for go.mod
if [ ! -f "go.mod" ]; then
    echo "❌ Error: go.mod not found in $SAMPLE_DIR"
    exit 1
fi

# Run gofmt
echo "🎨 Checking Go formatting..."
gofmt -l . | grep -q . && {
    echo "❌ Formatting issues found. Run 'gofmt -w .' to fix"
    exit 1
} || echo "✅ Go formatting OK"

# Run go vet
echo "🔎 Running go vet..."
go vet ./...

echo "✅ Go linting passed"
