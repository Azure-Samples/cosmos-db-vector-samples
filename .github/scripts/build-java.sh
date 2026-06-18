#!/bin/bash

# Build script for nosql-create-index-java sample
# Usage: ./build-java.sh

set -e

SAMPLE_DIR="nosql-create-index-java"

echo "🔨 Building Java sample: $SAMPLE_DIR"

cd "$SAMPLE_DIR"

# Check for pom.xml
if [ ! -f "pom.xml" ]; then
    echo "❌ Error: pom.xml not found in $SAMPLE_DIR"
    exit 1
fi

# Check for Maven
if ! command -v mvn &> /dev/null; then
    echo "❌ Error: Maven is not installed"
    exit 1
fi

# Build with Maven
echo "📦 Building with Maven..."
mvn clean compile -q

echo "✅ Java sample compiled successfully"
