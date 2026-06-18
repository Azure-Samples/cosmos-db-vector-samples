#!/bin/bash

# Lint script for nosql-create-index-python sample
# Usage: ./lint-python.sh

set -e

SAMPLE_DIR="nosql-create-index-python"

echo "🔍 Linting Python sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for requirements.txt
if [ ! -f "requirements.txt" ]; then
    echo "❌ Error: requirements.txt not found in $SAMPLE_DIR"
    exit 1
fi

# Create/activate virtual environment
if [ ! -d ".venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python -m venv .venv
fi

source .venv/bin/activate || . .venv/Scripts/activate

# Install lint tools
echo "📦 Installing lint tools..."
pip install -q pylint flake8

# Run flake8
echo "🎨 Running flake8..."
flake8 src/ --max-line-length=100 --extend-ignore=E203,W503 || true

# Run pylint
echo "🔎 Running pylint..."
pylint src/ --disable=C0111,C0103 --fail-under=7.0 || true

echo "✅ Python linting complete"
