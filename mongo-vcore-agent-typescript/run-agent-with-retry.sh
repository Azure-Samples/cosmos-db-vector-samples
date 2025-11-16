#!/bin/bash
# Run agent with automatic retry on rate limit errors
# Usage: ./run-agent-with-retry.sh

MAX_RETRIES=3
RETRY_DELAY=65  # Wait 65 seconds (quota resets every 60s)

echo "🤖 Starting agent with automatic retry on rate limits..."
echo "   Max retries: $MAX_RETRIES"
echo "   Delay between retries: ${RETRY_DELAY}s"
echo ""

for i in $(seq 1 $MAX_RETRIES); do
    echo "📍 Attempt $i of $MAX_RETRIES"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    npm run start:agent
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo ""
        echo "✅ Agent completed successfully!"
        exit 0
    fi
    
    if [ $i -lt $MAX_RETRIES ]; then
        echo ""
        echo "⚠️  Agent failed (exit code: $EXIT_CODE)"
        echo "⏳ Waiting ${RETRY_DELAY} seconds for quota to reset..."
        echo "   (You can Ctrl+C to cancel)"
        sleep $RETRY_DELAY
        echo ""
    else
        echo ""
        echo "❌ Agent failed after $MAX_RETRIES attempts"
        echo "💡 Your Azure OpenAI quota may be exhausted for longer"
        echo "   Solutions:"
        echo "   1. Wait a few minutes and try again"
        echo "   2. Request quota increase in Azure Portal"
        echo "   3. Check your quota usage at: https://portal.azure.com"
        exit $EXIT_CODE
    fi
done
