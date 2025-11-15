# LangChain Best Practices for Rate Limit Handling

## Current Implementation ✅

Your code already implements several LangChain best practices:

```typescript
const chatClient = new AzureChatOpenAI({
    // ... connection details
    maxRetries: 5,              // ✅ Automatic retry with exponential backoff
    timeout: 60000,             // ✅ 60 second timeout
});
```

This handles transient failures and implements exponential backoff automatically.

## Recommended Improvements

### 1. **Add `maxConcurrency` to Control Request Rate** ⭐ RECOMMENDED

The most LangChain-native way is to use the `maxConcurrency` option:

```typescript
// In utils.ts - Update getChatClient and getChatClientPasswordless
export function getChatClient(maxRetries: number = 5): AzureChatOpenAI {
    return new AzureChatOpenAI({
        azureOpenAIApiKey: apiKey,
        azureOpenAIApiVersion: apiVersion,
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiInstanceName: instanceName,
        azureOpenAIApiDeploymentName: deployment,
        maxRetries,              
        timeout: 60000,
        maxConcurrency: 1,       // ⭐ Only 1 concurrent request at a time
    });
}
```

**Benefits:**
- Native LangChain parameter
- Prevents multiple agent requests from overwhelming quota
- Works across all LangChain components automatically

### 2. **Configure Retry Behavior with Custom Logic**

For more control, customize the retry behavior:

```typescript
export function getChatClient(maxRetries: number = 5): AzureChatOpenAI {
    return new AzureChatOpenAI({
        // ... other config
        maxRetries,
        timeout: 60000,
        maxConcurrency: 1,
        
        // Custom retry configuration
        onFailedAttempt: (error) => {
            console.log(`   ⚠️  Retry attempt ${error.attemptNumber}/${maxRetries}`);
            if (error.message.includes('429')) {
                console.log(`   ⏱️  Rate limit hit - waiting for retry...`);
            }
        },
    });
}
```

### 3. **Use RunnableConfig with Rate Limiting** ⭐ BEST PRACTICE

The **most LangChain-native approach** is to use `RunnableConfig` with built-in rate limiting:

```typescript
import { RunnableConfig } from '@langchain/core/runnables';

// Create a rate-limited configuration
const rateLimitedConfig: RunnableConfig = {
    maxConcurrency: 1,           // Max concurrent LLM calls
    recursionLimit: 10,          // Max chain depth
    callbacks: [
        {
            handleLLMStart: async () => {
                console.log('   🤖 LLM Call: Rate-limited request starting...');
            },
            handleRetry: async (error: Error) => {
                console.log(`   ⚠️  Retry: ${error.message}`);
            }
        }
    ]
};

// Use in agent invocation
const result = await agent.invoke(
    { input: query }, 
    rateLimitedConfig
);
```

### 4. **Implement Request Queueing for Multiple Users**

For production with multiple concurrent users:

```typescript
import { Queue } from 'async';

// Create a queue that processes 1 request at a time
const requestQueue = Queue(async (task: { query: string, resolve: Function, reject: Function }) => {
    try {
        const result = await agent.invoke({ input: task.query });
        task.resolve(result);
    } catch (error) {
        task.reject(error);
    }
}, 1); // Concurrency of 1

// Wrap agent calls in the queue
async function invokeAgentWithQueue(query: string) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ query, resolve, reject });
    });
}
```

### 5. **Add Fallback to Lower-Priority Model** ⭐ RECOMMENDED

LangChain's native fallback pattern:

```typescript
import { ChatOpenAI } from '@langchain/openai';

// Primary model
const primaryModel = new AzureChatOpenAI({
    azureOpenAIApiDeploymentName: 'gpt-4',
    maxRetries: 2,
    timeout: 30000,
});

// Fallback model (if you have one with more quota)
const fallbackModel = new AzureChatOpenAI({
    azureOpenAIApiDeploymentName: 'gpt-35-turbo', // Fallback to cheaper/higher quota model
    maxRetries: 5,
    timeout: 60000,
});

// Use withFallbacks
const resilientModel = primaryModel.withFallbacks({
    fallbacks: [fallbackModel],
});

// Use resilient model in agent
const agent = await createToolCallingAgent({
    llm: resilientModel,  // ⭐ Automatically falls back on rate limit
    tools,
    prompt
});
```

### 6. **Add Circuit Breaker Pattern**

For production resilience:

```typescript
class CircuitBreaker {
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly threshold = 3;
    private readonly timeout = 60000; // 60 seconds

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.isOpen()) {
            throw new Error('Circuit breaker is OPEN - too many rate limit errors');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            if (error.message?.includes('429')) {
                this.onFailure();
            }
            throw error;
        }
    }

    private isOpen(): boolean {
        if (this.failureCount >= this.threshold) {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure < this.timeout) {
                return true;
            }
            this.reset();
        }
        return false;
    }

    private onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        console.log(`   ⚠️  Circuit breaker: ${this.failureCount}/${this.threshold} failures`);
    }

    private onSuccess() {
        this.reset();
    }

    private reset() {
        this.failureCount = 0;
    }
}

// Usage
const circuitBreaker = new CircuitBreaker();

async function invokeAgentWithCircuitBreaker(query: string) {
    return circuitBreaker.execute(async () => {
        return await agent.invoke({ input: query });
    });
}
```

## Recommended Implementation for Your Case

**Quick Win (5 minutes):** Add to your existing code:

```typescript
// In utils.ts - Update both getChatClient functions
export function getChatClient(maxRetries: number = 5): AzureChatOpenAI {
    return new AzureChatOpenAI({
        azureOpenAIApiKey: apiKey,
        azureOpenAIApiVersion: apiVersion,
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiInstanceName: instanceName,
        azureOpenAIApiDeploymentName: deployment,
        maxRetries,              
        timeout: 60000,
        maxConcurrency: 1,       // ⭐ ADD THIS - Prevents overwhelming quota
    });
}
```

**Production-Ready (30 minutes):** Implement fallback model:

```typescript
// Add to agent.ts
const primaryClient = getChatClient(2); // Fewer retries on primary
const fallbackClient = getChatClient(5); // More retries on fallback

const resilientClient = primaryClient.withFallbacks({
    fallbacks: [fallbackClient],
});

const agent = await createToolCallingAgent({
    llm: resilientClient,  // Use resilient client
    tools,
    prompt
});
```

## Summary

**Most LangChain-Native Approaches (in order):**

1. ✅ `maxRetries` with exponential backoff (you already have this!)
2. ⭐ `maxConcurrency: 1` to limit concurrent requests (EASY WIN)
3. ⭐ `withFallbacks()` to use backup models (RECOMMENDED)
4. 🔧 `RunnableConfig` for fine-grained control
5. 🏗️ Circuit breaker for production resilience

The **quickest improvement** is adding `maxConcurrency: 1` to your chat client config.
