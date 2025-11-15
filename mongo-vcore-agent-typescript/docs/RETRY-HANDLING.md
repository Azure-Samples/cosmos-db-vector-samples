# Retry and Quota Handling Guide

This guide explains how to handle rate limits, quotas, and transient errors when working with Azure OpenAI and LangChain.

## 🎯 Overview

Azure OpenAI enforces quotas and rate limits to ensure fair usage and service stability:

- **TPM (Tokens Per Minute)**: Maximum tokens processed per minute
- **RPM (Requests Per Minute)**: Maximum API requests per minute
- **429 Status Code**: Returned when limits are exceeded
- **503/500 Errors**: Transient service errors that should be retried

## 📦 Built-in Features

### LangChain's Native Retry Support

Both `AzureChatOpenAI` and `AzureOpenAI` clients have **built-in retry logic**:

```typescript
const chatClient = new AzureChatOpenAI({
    // ... auth config ...
    maxRetries: 5,        // Number of retry attempts (default: 2)
    timeout: 60000,       // Request timeout in milliseconds
});
```

**How it works:**
- Automatically retries on 429, 500, 503, 504 errors
- Uses exponential backoff (1s, 2s, 4s, 8s, 16s...)
- Respects `Retry-After` header from Azure

## 🛠️ Custom Retry Utilities

For more control, we've added custom retry utilities in `utils.ts`:

### 1. `withRetry<T>()` - Generic Retry Wrapper

Wraps any async operation with retry logic:

```typescript
import { withRetry } from './utils.js';

const result = await withRetry(
    () => someAsyncOperation(),
    {
        operationName: 'My Operation',
        config: {
            maxRetries: 5,
            initialDelayMs: 1000,
            maxDelayMs: 60000,
            backoffMultiplier: 2
        },
        onRetry: (attempt, delay, error) => {
            console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`);
        }
    }
);
```

### 2. `DEFAULT_RETRY_CONFIG` - Sensible Defaults

Pre-configured retry settings optimized for Azure OpenAI:

```typescript
{
    maxRetries: 5,                                      // 5 retry attempts
    initialDelayMs: 1000,                               // Start with 1 second
    maxDelayMs: 60000,                                  // Cap at 60 seconds
    backoffMultiplier: 2,                               // Exponential backoff
    retryableStatusCodes: [429, 503, 500, 502, 504]    // Retry these HTTP codes
}
```

### 3. `isRetriableError()` - Smart Error Detection

Determines if an error should be retried:

```typescript
if (isRetriableError(error)) {
    // Retry the operation
}
```

**Checks for:**
- HTTP status codes: 429 (rate limit), 503 (unavailable), 500+ (server errors)
- Network errors: ECONNRESET, ETIMEDOUT, ENOTFOUND
- Error messages containing: "rate limit", "quota", "too many requests"

### 4. `getRetryAfterMs()` - Respect Server Instructions

Extracts the `Retry-After` header from 429 responses:

```typescript
const retryDelay = getRetryAfterMs(error);
if (retryDelay) {
    await sleep(retryDelay);
}
```

### 5. `calculateBackoffDelay()` - Exponential Backoff with Jitter

Calculates delay with randomization to prevent thundering herd:

```typescript
const delay = calculateBackoffDelay(attemptNumber);
// Attempt 0: ~1s
// Attempt 1: ~2s
// Attempt 2: ~4s
// Attempt 3: ~8s
// Attempt 4: ~16s
```

**Jitter:** Adds ±25% randomization to prevent all retries happening simultaneously.

## 📖 Usage Examples

### Example 1: Agent with Retry Configuration

```typescript
import { getChatClientPasswordless, withRetry } from './utils.js';

// Create chat client with 5 retries (LangChain's built-in retry)
const chatClient = getChatClientPasswordless(5);

// Wrap agent invocation with additional retry layer
const result = await withRetry(
    () => agent.invoke({ input: query }),
    {
        operationName: 'Agent Query',
        config: { maxRetries: 3 },
        onRetry: (attempt, delay, error) => {
            console.log(`🔄 Retry ${attempt} after ${delay}ms`);
        }
    }
);
```

### Example 2: Embedding Generation with Retry

```typescript
import { withRetry } from './utils.js';

async function generateEmbeddingsWithRetry(texts: string[]) {
    return await withRetry(
        async () => {
            const embeddings = await aiClient.embeddings.create({
                input: texts,
                model: 'text-embedding-ada-002'
            });
            return embeddings.data.map(e => e.embedding);
        },
        {
            operationName: 'Embedding Generation',
            config: { 
                maxRetries: 5,
                initialDelayMs: 2000  // Start with 2s delay for embeddings
            }
        }
    );
}
```

### Example 3: Batch Operations with Per-Item Retry

```typescript
async function processBatchWithRetries<T>(
    items: T[],
    processItem: (item: T) => Promise<void>
) {
    const results = await Promise.allSettled(
        items.map(item =>
            withRetry(
                () => processItem(item),
                {
                    operationName: `Process item`,
                    config: { maxRetries: 3 }
                }
            )
        )
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`✅ ${succeeded} succeeded, ❌ ${failed} failed`);
}
```

## 🎚️ Tuning Retry Behavior

### For Development (Faster Failures)

```typescript
const DEV_RETRY_CONFIG = {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 503]
};
```

### For Production (More Resilient)

```typescript
const PROD_RETRY_CONFIG = {
    maxRetries: 10,
    initialDelayMs: 2000,
    maxDelayMs: 120000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 503, 500, 502, 504]
};
```

### For Batch Processing (Conservative)

```typescript
const BATCH_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 5000,
    maxDelayMs: 30000,
    backoffMultiplier: 1.5,  // Slower exponential growth
    retryableStatusCodes: [429, 503]
};
```

## 🚦 Rate Limit Best Practices

### 1. Monitor Your Quotas

Check your Azure OpenAI deployment capacity:
- **Embedding Model**: 8 TPM in current setup
- **Chat Model**: 10 TPM in current setup
- Track usage in Azure Portal → Metrics

### 2. Implement Circuit Breakers

For repeated failures, temporarily stop making requests:

```typescript
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

try {
    await withRetry(() => operation());
    consecutiveFailures = 0;
} catch (error) {
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error('Circuit breaker triggered - too many failures');
        // Stop processing, alert monitoring, etc.
    }
}
```

### 3. Use Batch Processing Wisely

Reduce API calls by batching:

```typescript
// Instead of 100 individual calls:
for (const item of items) {
    await embeddings.create({ input: [item] });  // ❌ 100 API calls
}

// Batch them:
const BATCH_SIZE = 16;
for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await embeddings.create({ input: batch });    // ✅ ~7 API calls
}
```

### 4. Implement Graceful Degradation

Have fallback behaviors for quota exhaustion:

```typescript
try {
    result = await withRetry(() => premiumModel.invoke(query));
} catch (error) {
    if (error.status === 429) {
        console.warn('Premium model quota exceeded, using fallback');
        result = await fallbackModel.invoke(query);
    }
}
```

## 🔍 Monitoring and Debugging

### Enable Verbose Logging

```typescript
const agent = new AgentExecutor({
    agent,
    tools,
    verbose: true  // Shows all agent steps and retries
});
```

### Track Retry Metrics

```typescript
let totalRetries = 0;
let totalRequests = 0;

await withRetry(
    () => operation(),
    {
        onRetry: (attempt) => {
            totalRetries++;
        }
    }
);
totalRequests++;

console.log(`Retry rate: ${(totalRetries/totalRequests * 100).toFixed(1)}%`);
```

### Log Quota Events

```typescript
const logQuotaEvent = (error: any) => {
    if (error.status === 429) {
        console.error('⚠️ QUOTA EXCEEDED', {
            timestamp: new Date().toISOString(),
            endpoint: error.url,
            retryAfter: getRetryAfterMs(error)
        });
    }
};
```

## ❓ FAQ

**Q: Why do I see "attemptNumber: 7, retriesLeft: 0"?**  
A: LangChain's default is 2 retries, but our wrapper adds more. Total attempts = 1 + retries.

**Q: Should I always use `withRetry`?**  
A: No - LangChain's built-in retries are usually sufficient. Use `withRetry` for:
- Custom operations (non-LangChain)
- Additional retry layers
- Custom retry logic

**Q: How do I know if I'm hitting quota limits?**  
A: Look for:
- 429 status codes
- "rate limit" or "quota" in error messages
- Sudden increase in retry attempts

**Q: Can I disable retries for testing?**  
A: Yes: `getChatClient(0)` or `maxRetries: 0` in config.

## 🔗 Related Resources

- [Azure OpenAI Rate Limits](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits)
- [LangChain Error Handling](https://python.langchain.com/docs/guides/productionization/safety/retries)
- [Exponential Backoff Best Practices](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
