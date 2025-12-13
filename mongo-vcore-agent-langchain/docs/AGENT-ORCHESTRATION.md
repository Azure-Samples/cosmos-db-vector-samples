# Agent Orchestration Patterns

> **Purpose**: This document explains the agent orchestration architecture in a framework-agnostic way, so it can be implemented with any AI framework (LangChain, Semantic Kernel, LlamaIndex, Autogen, custom implementation, etc.).

## Table of Contents

- [Overview](#overview)
- [Two-Agent Architecture](#two-agent-architecture)
- [Agent 1: Planner (Tool Calling Agent)](#agent-1-planner-tool-calling-agent)
- [Agent 2: Synthesizer (Response Generation)](#agent-2-synthesizer-response-generation)
- [Tool Calling / Function Calling](#tool-calling--function-calling)
- [Prompt Engineering](#prompt-engineering)
- [Data Flow and Context Passing](#data-flow-and-context-passing)
- [Error Handling and Debugging](#error-handling-and-debugging)
- [Framework Implementation Patterns](#framework-implementation-patterns)

---

## Overview

### What is Agent Orchestration?

Agent orchestration is the pattern of coordinating multiple AI agents (LLMs with specific roles) to accomplish a complex task. Instead of one monolithic prompt, we break the problem into stages:

1. **Planning**: Understanding user intent and gathering relevant information
2. **Synthesis**: Analyzing information and generating a final response

### Why Two Agents?

**Separation of Concerns**:
- **Planner**: Focused on query refinement and tool selection (cheaper, faster model)
- **Synthesizer**: Focused on reasoning and natural language generation (more capable model)

**Cost Optimization**:
- Use smaller model (gpt-4o-mini) for structured tasks
- Use larger model (gpt-4o) only for final response generation

**Performance**:
- Tool calling optimized for smaller models
- Complex reasoning optimized for larger models

---

## Two-Agent Architecture

### Agent Pipeline Flow

```
User Query: "cheap hotel near downtown"
         ↓
    ┌────────────────────────────────────────┐
    │      AGENT 1: PLANNER                  │
    │  Model: gpt-4o-mini                    │
    │  Role: Query Refinement + Tool Calling │
    └────────────────────────────────────────┘
         ↓
    Refined Query: "budget-friendly hotel near 
                    downtown with good value"
    Tool Call: search_hotels_collection(
                 query="...", 
                 nearestNeighbors=10
               )
         ↓
    ┌────────────────────────────────────────┐
    │      VECTOR SEARCH TOOL                │
    │  - Generate embedding                  │
    │  - Query Cosmos DB                     │
    │  - Return top-k results                │
    └────────────────────────────────────────┘
         ↓
    Search Results: [
      {hotel1, score: 0.95},
      {hotel2, score: 0.92},
      {hotel3, score: 0.89},
      ...
    ]
         ↓
    ┌────────────────────────────────────────┐
    │      AGENT 2: SYNTHESIZER              │
    │  Model: gpt-4o                         │
    │  Role: Compare & Recommend             │
    └────────────────────────────────────────┘
         ↓
    Final Response: "Based on your search, I 
    recommend Hotel A because... Consider 
    Hotel B if..."
```

### Key Design Decisions

**Why not one agent?**
- Single agent with both capabilities is more expensive
- Harder to optimize prompts for different tasks
- Less control over intermediate outputs

**Why not three+ agents?**
- Two stages are sufficient for this use case
- More agents = more complexity and latency
- Diminishing returns on additional stages

---

## Agent 1: Planner (Tool Calling Agent)

### Purpose

Transform user's potentially vague query into:
1. A well-structured search query
2. A tool call with appropriate parameters

### Capabilities Required

- **Understanding**: Parse user intent
- **Query refinement**: Improve search quality
- **Tool selection**: Choose correct tool and parameters
- **Function calling**: Execute tool with proper schema

### System Prompt Design

**Role Definition**:
```
You are a hotel search planner. Your job is to:
1. Understand what the user is looking for
2. Refine their query to be more specific
3. Call the search tool with appropriate parameters
```

**Critical Instructions**:
```
MANDATORY: You MUST call the search_hotels_collection tool.
Do not attempt to answer without calling this tool.
```

**Output Format**:
```
Return ONLY a tool call in this format:
{
  "tool": "search_hotels_collection",
  "args": {
    "query": "<refined_query>",
    "nearestNeighbors": <number>
  }
}
```

**Examples** (few-shot prompting):
```
User: "cheap hotel"
→ {"tool": "search_hotels_collection", 
    "args": {"query": "budget-friendly hotel with good value", 
             "nearestNeighbors": 10}}

User: "hotel near downtown with parking"
→ {"tool": "search_hotels_collection", 
    "args": {"query": "hotel near downtown with parking and wifi", 
             "nearestNeighbors": 5}}
```

### User Message Format

```
Call the "search_hotels_collection" tool with:
- nearestNeighbors: {k}
- query: "{user_query}"

Respond ONLY with tool call JSON.
```

**Why explicit instructions?**
- Ensures consistent tool calling behavior
- Reduces hallucination
- Makes debugging easier

### Tool Definition

The tool must be registered with:

**Name**: `search_hotels_collection`

**Description**:
```
Performs vector similarity search on Hotels collection.
Returns hotels matching the query with similarity scores.
Use this tool for EVERY hotel search request.
```

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Natural language search query describing desired hotel characteristics"
    },
    "nearestNeighbors": {
      "type": "integer",
      "description": "Number of results to return (1-20)"
    }
  },
  "required": ["query", "nearestNeighbors"]
}
```

**Tool Implementation**:
```
function search_hotels_collection(query: string, nearestNeighbors: number):
  1. embedding = generate_embedding(query)
  2. results = vector_search(embedding, k=nearestNeighbors)
  3. formatted = format_results(results)
  4. return formatted as JSON string
```

### Extracting Tool Output

After the planner agent completes:

1. **Parse agent response** to find tool call
2. **Extract tool output** (search results)
3. **Format as string** for next agent

**LangChain Example Pattern**:
```
messages = agent_result.messages
for message in messages:
  if message.type == "tool":
    return message.content
```

**Custom Framework Pattern**:
```
response = call_llm_with_tools(...)
if response.tool_calls:
  tool_result = execute_tool(response.tool_calls[0])
  return tool_result
```

---

## Agent 2: Synthesizer (Response Generation)

### Purpose

Generate natural language recommendation by:
1. Comparing top hotel results
2. Identifying key tradeoffs
3. Recommending best option with reasoning
4. Suggesting alternatives

### Capabilities Required

- **Analysis**: Compare multiple options across dimensions
- **Reasoning**: Identify tradeoffs and best fit
- **Natural language generation**: Clear, concise recommendations
- **No tool calling**: Pure generation task

### System Prompt Design

**Role Definition**:
```
You are an expert hotel recommendation assistant.
Your job is to help users choose between hotel options.
```

**Constraints**:
```
- Only use the TOP 3 results provided
- Do not request additional searches
- Do not call any tools
```

**Task Instructions**:
```
Compare the top 3 hotels across:
- Rating
- Similarity score  
- Location
- Category
- Tags (parking, wifi, pool, etc.)
- Any other differentiating features
```

**Output Format**:
```
Structure your response:
1. COMPARISON SUMMARY: Key differences between top 3
2. BEST OVERALL: Recommend #1 choice with reasoning
3. ALTERNATIVES: When to choose options 2 or 3

Format: Plain text, no markdown
Length: Under 220 words
Use bullet points and short sentences
```

**Quality Requirements**:
```
- Be decisive (pick one as best)
- Be specific (use actual hotel names and attributes)
- Be concise (no fluff)
- Be comparative (explain tradeoffs)
```

### User Message Format

```
User asked: {original_query}

Tool summary:
{formatted_search_results}

Analyze the TOP 3 results and provide recommendation.
```

**Formatting Search Results**:

Each hotel should be formatted as:
```
--- HOTEL START ---
HotelId: 123
HotelName: Example Hotel
Description: Beautiful hotel with...
Category: Luxury
Tags: pool, wifi, parking
Rating: 4.5
Address.City: Seattle
Score: 0.950000
--- HOTEL END ---
```

**Why this format?**
- Clear delimiters for each hotel
- Flat structure (no nested JSON)
- Easy for LLM to parse
- Includes similarity score for comparison

### No Tool Calling

The synthesizer should NOT:
- Call additional tools
- Request more information
- Perform new searches

**Why?**
- Keeps flow simple and predictable
- Prevents infinite loops
- Forces decision-making with available data

---

## Tool Calling / Function Calling

### What is Tool Calling?

Tool calling (also called function calling) allows LLMs to:
1. Recognize when they need external data
2. Format a request to call a specific function
3. Wait for function result
4. Continue with the result

### Implementation Requirements

**Framework Support**: Your framework must support:
- Registering tools/functions with schema
- LLM generating tool calls in responses
- Executing tools and injecting results back

**Common Frameworks**:
- ✅ LangChain: Native tool support
- ✅ Semantic Kernel: Plugin system  
- ✅ LlamaIndex: Tool abstractions
- ✅ Autogen: Tool execution
- ✅ OpenAI SDK: Direct function calling
- ✅ Custom: Implement via prompt engineering

### Tool Registration Pattern

**Step 1: Define Tool Schema**
```json
{
  "name": "search_hotels_collection",
  "description": "Search hotels using vector similarity",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "nearestNeighbors": {"type": "integer"}
    },
    "required": ["query", "nearestNeighbors"]
  }
}
```

**Step 2: Implement Tool Function**
```python
def search_hotels_collection(query: str, nearestNeighbors: int) -> str:
    embedding = embedding_client.embed(query)
    results = vector_db.search(embedding, k=nearestNeighbors)
    return json.dumps(results)
```

**Step 3: Register Tool with Agent**
```python
agent = create_agent(
    model=chat_model,
    tools=[search_hotels_collection],
    system_prompt=PLANNER_SYSTEM_PROMPT
)
```

### Tool Execution Flow

```
1. User message sent to LLM
   ↓
2. LLM decides to call tool
   Returns: {
     "tool_call": {
       "name": "search_hotels_collection",
       "arguments": {"query": "...", "nearestNeighbors": 5}
     }
   }
   ↓
3. Framework extracts tool call
   ↓
4. Framework executes: search_hotels_collection("...", 5)
   ↓
5. Tool returns: "[{hotel1}, {hotel2}, ...]"
   ↓
6. Framework injects tool result back to LLM
   ↓
7. LLM processes result and continues
```

### Context Passing to Tools

Some tools need additional context (like database connections):

**LangChain Pattern** (context parameter):
```python
@tool
def search_hotels(query: str, nearestNeighbors: int, config: dict):
    store = config["context"]["store"]
    embedding_client = config["context"]["embedding_client"]
    # Use store and embedding_client
```

**Semantic Kernel Pattern** (dependency injection):
```csharp
[KernelFunction]
public async Task<string> SearchHotels(
    string query, 
    int nearestNeighbors,
    [FromKernelContext] VectorStore store)
{
    // Use store
}
```

**Custom Pattern** (closure):
```javascript
function createSearchTool(store, embeddingClient) {
  return {
    name: "search_hotels",
    execute: async (query, k) => {
      // Closure has access to store and embeddingClient
    }
  }
}
```

---

## Prompt Engineering

### Prompt Components

Every agent invocation has:

1. **System Prompt**: Agent's role, capabilities, constraints
2. **User Message**: Current request with context
3. **Tool Definitions** (for planner only)
4. **Examples** (optional, for few-shot learning)

### Key Principles

**Clarity over Brevity**:
- Be explicit about what the agent should/shouldn't do
- Don't assume the model will infer intent

**Constraints First**:
- State limitations early (e.g., "Do NOT call additional tools")
- Prevents unwanted behavior

**Output Format**:
- Specify exact format (JSON, plain text, etc.)
- Provide examples of expected output

**Examples for Stability**:
- Few-shot prompting improves consistency
- Show both input and expected output

### Planner Prompt Patterns

**Bad** (vague):
```
"Help the user search for hotels."
```

**Good** (specific):
```
"You are a hotel search planner.
MANDATORY: Call the search_hotels_collection tool.
Refine the user's query to be more specific.
Return ONLY tool call JSON."
```

### Synthesizer Prompt Patterns

**Bad** (open-ended):
```
"Recommend hotels based on the search results."
```

**Good** (constrained):
```
"Compare ONLY the top 3 results.
Identify key tradeoffs.
Recommend the best option with one clear reason.
Format: Plain text, under 220 words."
```

---

## Data Flow and Context Passing

### Pipeline Context

As data flows through the pipeline, context accumulates:

```
Stage 1: User Input
  Context: {
    "query": "cheap hotel near downtown"
  }
         ↓
Stage 2: Planner Output
  Context: {
    "query": "cheap hotel near downtown",
    "refined_query": "budget hotel near downtown with good value",
    "k": 10
  }
         ↓
Stage 3: Tool Output
  Context: {
    "query": "cheap hotel near downtown",
    "refined_query": "...",
    "k": 10,
    "search_results": [{hotel1}, {hotel2}, ...]
  }
         ↓
Stage 4: Synthesizer Input
  Context: {
    "query": "cheap hotel near downtown",
    "search_results": "formatted as text"
  }
```

### Context Scoping

**Planner Needs**:
- User query
- Vector store connection
- Embedding client

**Synthesizer Needs**:
- Original user query
- Formatted search results

**What to Exclude**:
- Don't pass vector store to synthesizer
- Don't pass intermediate LLM outputs
- Keep context minimal and relevant

### State Management

**Stateless Pattern** (recommended):
- Each agent call is independent
- Context passed explicitly as parameters
- Easier to debug and test

**Stateful Pattern** (alternative):
- Shared memory/context object
- Agents read/write to shared state
- More complex but supports multi-turn conversations

---

## Error Handling and Debugging

### Common Failure Modes

1. **Tool Not Called**:
   - Cause: Prompt not explicit enough
   - Fix: Add "MANDATORY: Call tool" instruction

2. **Invalid Tool Arguments**:
   - Cause: Schema not clear or LLM hallucination
   - Fix: Strengthen parameter descriptions, add examples

3. **Empty Search Results**:
   - Cause: Query too specific or embedding mismatch
   - Fix: Return helpful message, adjust k value

4. **Synthesizer Requests More Data**:
   - Cause: Instructions not clear enough
   - Fix: Add "Do NOT request additional searches"

5. **Response Too Long/Short**:
   - Cause: No length constraint
   - Fix: Specify word/character limit explicitly

### Debugging Strategies

**Enable Verbose Logging**:
```
- Log every LLM request (system prompt + user message)
- Log every LLM response
- Log every tool call and result
- Log context passed between stages
```

**Callback Handlers** (LangChain example):
```python
callbacks = [
    LoggingCallback(),  # Logs all events
    DebugCallback(),    # Detailed introspection
]

agent.invoke(message, callbacks=callbacks)
```

**Custom Logging**:
```python
print(f"[Planner] Input: {user_query}")
result = planner_agent.invoke(user_query)
print(f"[Planner] Output: {result}")

tool_output = execute_tool(...)
print(f"[Tool] Results: {tool_output[:200]}...")

final = synthesizer_agent.invoke(context)
print(f"[Synthesizer] Output: {final}")
```

**Test Each Stage Independently**:
- Test planner with mock tool
- Test tool with hardcoded embeddings
- Test synthesizer with static search results

---

## Framework Implementation Patterns

### LangChain Pattern

```python
from langchain import createAgent
from langchain.tools import tool

# Define tool
@tool
def search_hotels_collection(query: str, nearestNeighbors: int, config) -> str:
    store = config["context"]["store"]
    # Execute search
    return json.dumps(results)

# Planner agent
planner = createAgent(
    model=chat_model_mini,
    systemPrompt=PLANNER_SYSTEM_PROMPT,
    tools=[search_hotels_collection],
    contextSchema=context_schema
)

# Execute planner
planner_result = planner.invoke(
    {"messages": [{"role": "user", "content": user_message}]},
    {"context": {"store": vector_store, "embedding_client": embeddings}}
)

# Extract results
search_results = extract_tool_output(planner_result.messages)

# Synthesizer agent (no tools)
synthesizer = createAgent(
    model=chat_model_large,
    systemPrompt=SYNTHESIZER_SYSTEM_PROMPT
)

# Execute synthesizer
synth_result = synthesizer.invoke({
    "messages": [{
        "role": "user", 
        "content": f"User: {query}\n\nResults: {search_results}"
    }]
})

final_answer = synth_result.messages[-1].content
```

### Semantic Kernel Pattern

```csharp
// Define plugin with tool
public class HotelSearchPlugin
{
    private readonly VectorStore _store;
    
    [KernelFunction]
    public async Task<string> SearchHotelsCollection(
        string query, 
        int nearestNeighbors)
    {
        var results = await _store.SearchAsync(query, nearestNeighbors);
        return JsonSerializer.Serialize(results);
    }
}

// Create kernel with plugins
var kernel = Kernel.CreateBuilder()
    .AddAzureOpenAIChatCompletion(deploymentName, endpoint)
    .Build();

kernel.ImportPluginFromObject(new HotelSearchPlugin(vectorStore));

// Planner invocation
var plannerSettings = new OpenAIPromptExecutionSettings 
{ 
    ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions 
};

var plannerResult = await kernel.InvokePromptAsync(
    $"{PLANNER_SYSTEM_PROMPT}\n\nUser: {userQuery}",
    new(plannerSettings)
);

// Synthesizer invocation (no tools)
var synthSettings = new OpenAIPromptExecutionSettings 
{ 
    ToolCallBehavior = ToolCallBehavior.None 
};

var synthResult = await kernel.InvokePromptAsync(
    $"{SYNTHESIZER_SYSTEM_PROMPT}\n\n{synthesizerInput}",
    new(synthSettings)
);
```

### OpenAI SDK Pattern (Direct Function Calling)

```python
import openai

# Define function schema
tools = [{
    "type": "function",
    "function": {
        "name": "search_hotels_collection",
        "description": "Search hotels using vector similarity",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "nearestNeighbors": {"type": "integer"}
            },
            "required": ["query", "nearestNeighbors"]
        }
    }
}]

# Planner call
response = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": user_query}
    ],
    tools=tools,
    tool_choice="required"
)

# Execute tool
if response.choices[0].message.tool_calls:
    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
    search_results = search_hotels_collection(**args)

# Synthesizer call (no tools)
synth_response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": SYNTHESIZER_SYSTEM_PROMPT},
        {"role": "user", "content": f"Query: {user_query}\n\nResults: {search_results}"}
    ]
)

final_answer = synth_response.choices[0].message.content
```

### Custom Framework Pattern

If building from scratch:

```python
class Agent:
    def __init__(self, model, system_prompt, tools=None):
        self.model = model
        self.system_prompt = system_prompt
        self.tools = tools or []
    
    def invoke(self, user_message, context=None):
        # Build messages
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]
        
        # Call LLM with tool definitions
        response = self.model.chat(
            messages=messages,
            tools=[tool.schema for tool in self.tools]
        )
        
        # Handle tool calls
        if response.tool_calls:
            for tool_call in response.tool_calls:
                tool = self._find_tool(tool_call.name)
                result = tool.execute(tool_call.arguments, context)
                # Optionally: inject result and call LLM again
        
        return response

# Usage
planner = Agent(
    model=gpt4o_mini,
    system_prompt=PLANNER_SYSTEM_PROMPT,
    tools=[search_tool]
)

result = planner.invoke(user_query, context={"store": vector_store})
```

---

## Summary

### Key Takeaways

1. **Two agents** optimize for cost and performance
2. **Planner** handles query refinement and tool calling (small model)
3. **Synthesizer** handles reasoning and generation (large model)
4. **Tool calling** requires framework support and careful schema design
5. **Prompts** must be explicit, constrained, and example-driven
6. **Context** flows through pipeline but should be scoped appropriately
7. **Debugging** requires verbose logging and stage isolation

### Implementation Steps

1. ✅ Choose AI framework (or build custom)
2. ✅ Implement vector search tool
3. ✅ Design and test planner prompts
4. ✅ Register tool with planner agent
5. ✅ Extract and format tool outputs
6. ✅ Design and test synthesizer prompts
7. ✅ Connect pipeline end-to-end
8. ✅ Add logging and error handling
9. ✅ Test with diverse queries
10. ✅ Optimize prompts based on results

### Extensibility

This pattern can be extended to:
- **More agents**: Add specialized roles (validation, formatting, etc.)
- **More tools**: Add reservation booking, price comparison, etc.
- **Multi-turn**: Add conversation memory and follow-up handling
- **Streaming**: Stream synthesizer output token-by-token
- **Parallel tools**: Call multiple tools simultaneously
- **Fallbacks**: Add retry logic or alternative models

---

## Related Documents

- **FUNCTIONAL-SPEC.md**: System requirements and data models
- **CODE.md**: TypeScript/LangChain implementation reference
- **SCRIPTS.md**: Testing and verification procedures
