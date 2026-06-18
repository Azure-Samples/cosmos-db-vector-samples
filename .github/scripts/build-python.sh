#!/bin/bash

# Build script for nosql-create-index-python sample
# Usage: ./build-python.sh

set -e

SAMPLE_DIR="nosql-create-index-python"

echo "🔨 Building Python sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for requirements.txt
if [ ! -f "requirements.txt" ]; then
    echo "❌ Error: requirements.txt not found in $SAMPLE_DIR"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate || . .venv/Scripts/activate

# Install dependencies
echo "📦 Installing Python dependencies..."
pip install -q -r requirements.txt

# Syntax check (compile without running)
echo "🏗️  Checking Python syntax..."
python -m py_compile src/index.py src/data_plane.py

echo "✅ Python sample dependencies installed and syntax verified"
