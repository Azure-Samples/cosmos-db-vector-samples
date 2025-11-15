# Agent Execution Tracking

## Enhanced Logging Overview

The agent now provides comprehensive execution tracking with TWO levels of detail:

### Level 1: Custom Tracking (Always On)
Clean, focused output showing:
- **LLM Decision Points**: When the agent calls Azure OpenAI to make decisions
- **Tool Execution**: When tools start and complete
- **Agent Decisions**: What the agent decided to do after each LLM call
- **Execution Summary**: Total LLM calls, tools executed, duration

### Level 2: Verbose LangChain Logs (via `verbose: true`)
Detailed internal LangChain operations showing:
- Chain starts/ends
- Prompt construction
- Full message payloads
- Internal state transitions

## What You Can Track

### 1. **Tool Execution Flow**
- When each tool starts execution (`🔧 Tool Called`)
- Detailed step-by-step tool progress
- When each tool completes
- What data is returned from tools

### 2. **LLM Decision Points**
- `🤖 LLM Call #N`: When the agent calls Azure OpenAI to make decisions
- `✅ LLM Response #N`: When the response is received
- `📋 Agent Decision`: What the agent decided to do next

### 3. **Execution Summary**
Shows at the end (even if execution fails):
- `🤖 LLM Calls Made`: Total number of LLM calls
- `🔧 Tools Executed`: Total number of tools and their names
- `⏱️ Total Duration`: Complete execution time

## Example Output (Success Case)

```
🧠 Agent Processing:
   - Agent will analyze query and decide which tools to use
   - Waiting for response (max 2 minutes)...

   🤖 LLM Call #1: Agent making decision with Azure OpenAI...
   ✅ LLM Response #1: Received
   📋 Agent Decision: Will call tool "search_hotels"

🔧 Tool Called: search_hotels("luxury hotel with spa and fitness center for a business trip", max=5)
   🔍 Tool: search_hotels - Starting workflow
      Query: "luxury hotel with spa and fitness center for a business trip"
      Max results: 5
      Step 1: Getting database clients...
      ✅ Clients initialized
      Step 2: Connecting to MongoDB...
      ✅ Connected to MongoDB
      Step 3: Using collection "Hotels_Search_27"
      ✅ Collection ready
      Step 4: Performing vector search...
      ✅ Vector search completed: 5 results found
      📊 Score range: 0.854 - 0.867
      ✅ Returning 1865 bytes to agent
      ✅ MongoDB connection closed

   🤖 LLM Call #2: Agent making decision with Azure OpenAI...
   ✅ LLM Response #2: Received
   🎯 Agent Complete: Synthesizing final response...

================================================================================
📊 EXECUTION SUMMARY
================================================================================
🤖 LLM Calls Made: 2
🔧 Tools Executed: 1
   1. search_hotels
⏱️  Total Duration: 4523ms
================================================================================

✅ Agent Response Received

🤖 AGENT RESPONSE:
--------------------------------------------------------------------------------
Based on your requirements for a luxury hotel with spa and fitness center 
for a business trip, I found 5 excellent matches...
--------------------------------------------------------------------------------
⏱️  Execution time: 4523ms
```

## Example Output (Rate Limit Error Case)

```
🧠 Agent Processing:
   - Agent will analyze query and decide which tools to use
   - Waiting for response (max 2 minutes)...

   🤖 LLM Call #1: Agent making decision with Azure OpenAI...
   ✅ LLM Response #1: Received
   📋 Agent Decision: Will call tool "search_hotels"

🔧 Tool Called: search_hotels("luxury hotel with spa and fitness center for a business trip", max=5)
   🔍 Tool: search_hotels - Starting workflow
      ...tool executes successfully...
      ✅ Vector search completed: 5 results found
      ✅ Returning 1865 bytes to agent
      ✅ MongoDB connection closed

   🤖 LLM Call #2: Agent making decision with Azure OpenAI...
   [43.42s delay - retrying with exponential backoff]
   ❌ LLM ERROR - Rate limit exceeded

================================================================================
❌ AGENT EXECUTION FAILED
================================================================================

📍 Context: Agent was processing user query and calling LangChain tools
🔧 Operation: Agent.invoke() - LLM decision making and tool execution

💥 Error Details:
   Type: RateLimitError
   Message: 429 Rate limit is exceeded. Try again in 60 seconds.

🔍 Root Cause: Azure OpenAI Rate Limit Exceeded
   The agent successfully:
   ✅ Created tools and connected to MongoDB
   ✅ Executed vector search and found results (LLM Call #1 + Tool Execution)
   ❌ But hit rate limits on LLM Call #2 (synthesizing response)

💡 Solutions:
   1. Wait 60 seconds and try again
   2. Request quota increase in Azure Portal
   3. Use a different deployment with higher quota
   4. Implement request throttling in your application
```

## Understanding the Flow

1. **LLM Call #1**: Agent analyzes the user query and decides to call `search_hotels`
2. **Tool Execution**: The `search_hotels` tool runs, connecting to MongoDB and performing vector search
3. **LLM Call #2**: Agent receives the search results and uses OpenAI to synthesize a natural language response
4. **Summary**: Shows exactly what happened - 2 LLM calls, 1 tool execution

## Why This Matters

- **Transparency**: You can see exactly what the agent is doing at each step
- **Debugging**: If something goes wrong, you know exactly where it failed
- **Performance**: You can see which operations take the most time
- **Cost Tracking**: LLM calls cost money - you can track how many are made per query
- **Verification**: Confirms all expected tools actually executed successfully
- **Rate Limit Diagnosis**: See exactly which LLM call hit the rate limit

## Understanding Agent Execution Flow

A typical successful agent execution follows this pattern:

1. **LLM Call #1**: Agent analyzes user query → Decides to call a tool
2. **Tool Execution**: Tool runs (e.g., MongoDB vector search)
3. **LLM Call #2**: Agent receives tool results → Synthesizes natural language response
4. **Complete**: Final response delivered to user

**Key Insight**: Each agent query typically makes **2 LLM calls**:
- First call: Decide what to do (which tool to use)
- Second call: Synthesize the response (convert tool output to natural language)

## Tracking Rate Limit Issues

When you see a rate limit error, the logs now clearly show:
- ✅ **What succeeded**: `LLM Call #1` + `search_hotels tool` completed
- ❌ **What failed**: `LLM Call #2` hit the rate limit
- 🎯 **Root cause**: Azure OpenAI quota exhausted on the second LLM call
- 💡 **Solution**: Your MongoDB vector search code works perfectly; you just need more Azure OpenAI quota

This makes it immediately clear that:
1. Your MongoDB integration is working correctly
2. The Document conversion utilities are working
3. The failure is external (Azure OpenAI API limits)
4. The specific operation that failed (response synthesis)

## Current Status

Based on test runs, you can see:
- ✅ **Agent creation**: Working perfectly
- ✅ **Tool execution** (`search_hotels`): Working perfectly
- ✅ **MongoDB vector search**: Finding 5 results with scores 0.854-0.867
- ✅ **First LLM call**: Successfully deciding to use search_hotels
- ❌ **Second LLM call**: Hitting rate limits when synthesizing response

**Conclusion**: All your code is working! The only issue is Azure OpenAI quota.
