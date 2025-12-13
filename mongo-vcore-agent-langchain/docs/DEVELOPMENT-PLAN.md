# Development Plan: Building the Hotel Recommendation Agent

> **Purpose**: A suggested development plan for implementing the hotel recommendation RAG agent in your preferred language/framework. This is a recommended approach, not a strict requirement - adapt to your team's workflow.

## Prerequisites

### What's Provided

✅ **Azure Infrastructure**: All resources provisioned via Bicep/Azure Developer CLI
  - Azure OpenAI with 3 model deployments
  - Azure Cosmos DB for MongoDB vCore cluster
  - Managed Identity for passwordless authentication
  - Vector index configuration

✅ **Sample Data**: Hotel JSON file (`HotelsData_toCosmosDB.JSON`)

✅ **Environment Variables**: `.env` file with all connection strings and configuration

✅ **Documentation**:
  - `FUNCTIONAL-SPEC.md`: System requirements and architecture
  - `AGENT-ORCHESTRATION.md`: Agent implementation patterns
  - `CODE.md`: TypeScript reference implementation
  - `azure-architecture.mmd`: Infrastructure diagram

### What You Need to Build

- Application code in your language (Python, C#, Java, etc.)
- Four executable entry points (auth test, upload, agent, cleanup)
- Vector search implementation
- Two-agent orchestration pipeline

---

## Suggested Development Phases

### Phase 1: Setup & Authentication (Days 1-2)

**Goal**: Verify you can connect to all Azure services before writing business logic.

#### Tasks

**1.1 Environment Setup**
- [ ] Create project structure in your language
- [ ] Install required dependencies:
  - Azure Identity SDK
  - OpenAI SDK (or Azure OpenAI SDK)
  - MongoDB driver with vector search support
  - Any AI framework (LangChain, Semantic Kernel, etc.) - optional

**1.2 Configuration Management**
- [ ] Load environment variables from `.env` file
- [ ] Create configuration classes/modules:
  ```
  - OpenAI config (instance, deployments, API versions)
  - MongoDB config (cluster, database, collection)
  - App config (debug mode, defaults)
  ```

**1.3 Authentication Implementation**
- [ ] Implement passwordless authentication helper:
  - Azure AD token provider for OpenAI
  - OIDC callback for MongoDB
- [ ] (Optional) Implement API key authentication fallback

**1.4 Client Factories**
- [ ] Create factory functions to instantiate:
  - Embedding client (text-embedding-3-small)
  - Chat client for planner (gpt-4o-mini)
  - Chat client for synthesizer (gpt-4o)
  - MongoDB client with vector search capability

**1.5 Verification Script**
- [ ] Build authentication test suite:
  - Test embedding API (generate test embedding)
  - Test planner model (send "hello" message)
  - Test synth model (send "hello" message)
  - Test MongoDB connection (list databases)
- [ ] Run test until all pass: `npm run auth` ✅

**Deliverable**: `test-auth` script that validates all 4 service connections

**Acceptance Criteria**: Running `npm run auth` shows all 4 tests passing with summary report

---

### Phase 2: Data Layer (Days 3-4)

**Goal**: Load hotel data into Cosmos DB with vector embeddings.

#### Tasks

**2.1 Data Loading**
- [ ] Read hotel JSON file
- [ ] Parse and validate hotel objects
- [ ] Understand data model (see FUNCTIONAL-SPEC.md)

**2.2 Vector Store Implementation**
- [ ] Implement document transformation:
  - Combine `HotelName` + `Description` as page content
  - Exclude `Description_fr`, `Location`, `Rooms`
  - Preserve metadata (all other fields)
- [ ] Generate embeddings for each document:
  - Call embedding API with page content
  - Handle rate limiting/batching if needed
- [ ] Insert documents into MongoDB:
  - Store document + metadata + embedding vector
  - Use field name: `contentVector`

**2.3 Vector Index Creation**
- [ ] Create vector index on collection:
  - Default: IVF with `numLists=10`
  - Support: HNSW and DiskANN via environment config
  - Dimensions: 1536
  - Similarity: Cosine (default)

**2.4 Upload Script**
- [ ] Build `upload-documents` script:
  - Connect to services
  - Transform and upload all documents
  - Create vector index
  - Report success (N documents inserted)

**2.5 Testing**
- [ ] Run upload script
- [ ] Verify collection exists in MongoDB
- [ ] Verify document count matches source file
- [ ] Verify vector index is created

**Deliverable**: `upload-documents` script that populates the database

**Acceptance Criteria**: Collection contains all hotels with embeddings and vector index

---

### Phase 3: Vector Search Tool (Days 5-6)

**Goal**: Implement semantic search over hotel collection.

#### Tasks

**3.1 Search Function**
- [ ] Implement vector search function:
  ```
  Input: query (string), k (int)
  Process:
    1. Generate embedding for query
    2. Execute MongoDB vector search
    3. Retrieve top-k results with scores
  Output: Array of hotel documents with similarity scores
  ```

**3.2 MongoDB Vector Search**
- [ ] Use MongoDB aggregation pipeline with `$search` stage
- [ ] Configure vector search parameters:
  - `queryVector`: Generated embedding
  - `path`: "contentVector"
  - `numCandidates`: k * 10 (oversampling)
  - `limit`: k
  - `similarity`: "cosine"
- [ ] Include similarity score in results

**3.3 Result Formatting**
- [ ] Format each result for agent consumption:
  ```
  --- HOTEL START ---
  HotelId: {id}
  HotelName: {name}
  Description: {desc}
  Category: {category}
  Tags: {tags}
  Rating: {rating}
  Address.City: {city}
  Score: {similarity_score}
  --- HOTEL END ---
  ```

**3.4 Standalone Testing**
- [ ] Create test script that:
  - Calls search with test query
  - Prints top 5 results
  - Validates scores are descending
- [ ] Test various queries:
  - "luxury hotel with pool"
  - "budget accommodation near downtown"
  - "family-friendly hotel with parking"

**Deliverable**: Working vector search function

**Acceptance Criteria**: Returns relevant hotels ranked by similarity for test queries

---

### Phase 4: Planner Agent (Days 7-9)

**Goal**: Build the first agent that refines queries and calls the search tool.

#### Tasks

**4.1 Tool Definition**
- [ ] Define search tool schema:
  - Name: "search_hotels_collection"
  - Description: Clear explanation for LLM
  - Parameters: query (string), nearestNeighbors (int)
  - Required fields marked
- [ ] Register tool with your framework (or implement manually)

**4.2 Tool Execution**
- [ ] Implement tool execution function:
  - Accepts tool call from LLM
  - Extracts parameters
  - Calls vector search
  - Returns formatted results
- [ ] Handle context passing (vector store, embedding client)

**4.3 Planner Prompt Engineering**
- [ ] Copy planner system prompt from `AGENT-ORCHESTRATION.md`
- [ ] Customize if needed for your framework
- [ ] Key elements:
  - Role: "hotel search planner"
  - Mandate: "MUST call the tool"
  - Format: JSON tool call structure
  - Examples: Few-shot examples

**4.4 Planner Implementation**
- [ ] Create planner agent:
  - Model: gpt-4o-mini
  - System prompt: Planner prompt
  - Tools: [search_hotels_collection]
  - Context: Vector store + embedding client
- [ ] Implement invocation pattern:
  - Send user query
  - Wait for tool call
  - Execute tool
  - Extract results

**4.5 Testing Planner**
- [ ] Test with various queries:
  - Simple: "cheap hotel"
  - Specific: "hotel near downtown with parking"
  - Vague: "nice place to stay"
- [ ] Verify planner:
  - Always calls the tool
  - Refines query appropriately
  - Returns valid search results
- [ ] Add debug logging to see:
  - Original query
  - Refined query
  - Tool call arguments
  - Search results

**Deliverable**: Working planner agent that calls vector search

**Acceptance Criteria**: Planner reliably calls tool with refined queries for diverse inputs

---

### Phase 5: Synthesizer Agent (Days 10-11)

**Goal**: Build the second agent that generates recommendations.

#### Tasks

**5.1 Synthesizer Prompt Engineering**
- [ ] Copy synthesizer system prompt from `AGENT-ORCHESTRATION.md`
- [ ] Key elements:
  - Role: "expert hotel recommendation assistant"
  - Constraint: "Only use top 3 results"
  - Task: "Compare and recommend"
  - Format: "Plain text, under 220 words"

**5.2 User Prompt Construction**
- [ ] Create function to build synthesizer input:
  ```
  User asked: {original_query}
  
  Tool summary:
  {formatted_search_results}
  
  Analyze the TOP 3 results...
  ```
- [ ] Ensure search results are properly formatted

**5.3 Synthesizer Implementation**
- [ ] Create synthesizer agent:
  - Model: gpt-4o
  - System prompt: Synthesizer prompt
  - NO tools (pure generation)
- [ ] Implement invocation:
  - Input: Query + search results
  - Output: Natural language recommendation

**5.4 Testing Synthesizer**
- [ ] Test with sample search results (can use static data)
- [ ] Verify output:
  - Compares top 3 hotels
  - Identifies tradeoffs
  - Recommends best option
  - Suggests alternatives
  - Stays under word limit
- [ ] Refine prompts if needed

**Deliverable**: Working synthesizer agent

**Acceptance Criteria**: Generates clear, concise recommendations comparing top options

---

### Phase 6: End-to-End Pipeline (Days 12-13)

**Goal**: Connect both agents into complete workflow.

#### Tasks

**6.1 Pipeline Orchestration**
- [ ] Build main agent function:
  ```python
  def run_agent(user_query):
    # 1. Run planner agent
    search_results = run_planner(user_query)
    
    # 2. Extract tool output
    formatted_results = extract_results(search_results)
    
    # 3. Run synthesizer agent
    final_answer = run_synthesizer(user_query, formatted_results)
    
    return final_answer
  ```

**6.2 Context Flow**
- [ ] Ensure proper data passing:
  - User query flows to both agents
  - Planner has access to vector store
  - Synthesizer receives formatted results
  - Original query preserved throughout

**6.3 Main Application**
- [ ] Create `agent` entry point script:
  - Load configuration
  - Initialize clients
  - Connect to vector store (no upload)
  - Accept query (from env var or CLI arg)
  - Run pipeline
  - Display final recommendation

**6.4 End-to-End Testing**
- [ ] Test complete pipeline with queries:
  - "luxury hotel with spa and pool"
  - "budget hotel near downtown Seattle"
  - "family-friendly accommodation with parking"
  - "business hotel with meeting rooms and wifi"
- [ ] Verify full flow works
- [ ] Check output quality

**6.5 Polish**
- [ ] Add console output formatting:
  - Section headers (--- PLANNER ---, --- SYNTHESIZER ---)
  - Character counts
  - Timing information (optional)
- [ ] Add error handling:
  - Connection failures
  - Empty search results
  - LLM errors

**Deliverable**: `agent` script that runs complete RAG pipeline

**Acceptance Criteria**: User query → Final recommendation works reliably

---

### Phase 7: Utilities & Cleanup (Day 14)

**Goal**: Complete the supporting scripts and polish.

#### Tasks

**7.1 Cleanup Script**
- [ ] Build `cleanup` script:
  - Connect to MongoDB with passwordless auth
  - Drop specified database
  - Confirm deletion
  - Report success

**7.2 Error Handling**
- [ ] Add comprehensive error handling:
  - Authentication failures
  - Network errors
  - Invalid responses
  - Empty results
- [ ] Provide helpful error messages

**7.3 Logging/Debug Mode**
- [ ] Implement debug mode (via DEBUG env var):
  - Log all LLM requests
  - Log all LLM responses
  - Log tool calls and results
  - Log context passing
- [ ] Keep production output clean

**7.4 Documentation**
- [ ] Write README for your implementation:
  - Prerequisites
  - Setup instructions
  - How to run each script
  - Environment variables
  - Troubleshooting
- [ ] Add code comments for complex sections

**7.5 Final Testing**
- [ ] Test all four entry points:
  - `test-auth` ✅
  - `upload-documents` ✅
  - `agent` ✅
  - `cleanup` ✅
- [ ] Test with diverse queries
- [ ] Test error scenarios

**Deliverable**: Complete, documented application

**Acceptance Criteria**: All scripts work, code is clean, README is clear

---

## Alternative Approaches

### Iterative Development (Faster Path)

If you want quicker results, consider this order:

**Week 1 Focus**: Get something working end-to-end
1. Day 1-2: Authentication + Vector Search (no agents)
2. Day 3: Single agent with hardcoded prompts
3. Day 4-5: Add second agent, connect pipeline
4. **Result**: Basic working demo

**Week 2 Focus**: Polish and optimize
1. Day 6-7: Improve prompts based on testing
2. Day 8-9: Add data upload script
3. Day 10: Add error handling and logging
4. Day 11-12: Write tests and documentation
5. **Result**: Production-ready application

### Framework-First vs. Framework-Free

**Option A: Use AI Framework**
- Faster development (abstractions provided)
- Less control over internals
- Examples: LangChain, Semantic Kernel, LlamaIndex

**Option B: Direct SDK Integration**
- More code to write
- Full control over behavior
- Better for learning/customization
- Use OpenAI SDK directly with custom orchestration

Both approaches are valid - choose based on team expertise and requirements.

---

## Testing Strategy

### Unit Tests

Test individual components in isolation:
- [ ] Configuration loading
- [ ] Authentication token acquisition
- [ ] Embedding generation
- [ ] Vector search query execution
- [ ] Result formatting
- [ ] Prompt construction

### Integration Tests

Test components working together:
- [ ] End-to-end authentication flow
- [ ] Data upload → query → results
- [ ] Planner → tool → synthesizer pipeline

### Functional Tests

Test with real queries:
- [ ] Diverse query types (specific, vague, multi-criteria)
- [ ] Edge cases (no results, many results)
- [ ] Error scenarios (bad auth, network issues)

### Quality Checks

Verify output quality:
- [ ] Recommendations are relevant
- [ ] Comparisons are accurate
- [ ] Output format is consistent
- [ ] Response time is acceptable (<10 seconds typical)

---

## Development Environment

### Recommended Tools

**IDE/Editor**:
- VS Code with language extensions
- Cursor, Copilot, or other AI assistants (highly recommended)

**Testing**:
- Language-specific test framework (pytest, xUnit, JUnit, etc.)
- Postman/curl for API testing

**Debugging**:
- Language debugger
- Azure Portal for resource monitoring
- Cosmos DB Data Explorer for database inspection

**Version Control**:
- Git for source control
- Branch strategy: feature branches → PR → main

### Environment Setup Checklist

- [ ] Language runtime installed (Python 3.10+, .NET 8+, Node 20+, etc.)
- [ ] Package manager configured (pip, npm, NuGet, Maven, etc.)
- [ ] Azure CLI installed and logged in (`az login`)
- [ ] `.env` file present with all variables
- [ ] Dependencies installed from package manifest

---

## Common Pitfalls to Avoid

### Authentication Issues
❌ **Don't**: Hardcode API keys in source code
✅ **Do**: Use environment variables and Azure Identity

❌ **Don't**: Skip authentication testing
✅ **Do**: Run `test-auth` first before building features

### Vector Search
❌ **Don't**: Forget to create vector index
✅ **Do**: Verify index exists before querying

❌ **Don't**: Use wrong embedding model for search
✅ **Do**: Same model for upload and query (text-embedding-3-small)

### Agent Orchestration
❌ **Don't**: Make prompts too vague
✅ **Do**: Be explicit about what agent should/shouldn't do

❌ **Don't**: Let synthesizer call additional tools
✅ **Do**: Constrain synthesizer to only analyze provided results

❌ **Don't**: Pass too much context between agents
✅ **Do**: Keep context minimal and relevant

### Error Handling
❌ **Don't**: Let exceptions crash the application silently
✅ **Do**: Catch, log, and provide helpful error messages

❌ **Don't**: Retry indefinitely on failures
✅ **Do**: Implement exponential backoff with max retries

---

## Success Metrics

### Phase Completion

Each phase is complete when:
- ✅ All tasks in checklist are done
- ✅ Tests pass
- ✅ Code is committed
- ✅ Documentation is updated

### Project Completion

Project is complete when:
- ✅ All 4 entry points work (`test-auth`, `upload`, `agent`, `cleanup`)
- ✅ Authentication works (preferably passwordless)
- ✅ Vector search returns relevant results
- ✅ Agent pipeline generates quality recommendations
- ✅ Code is clean, tested, and documented
- ✅ Demo-ready for stakeholders

### Quality Indicators

Your implementation is high quality if:
- ✅ Recommendations are accurate and helpful
- ✅ Response time is under 10 seconds (typical)
- ✅ Prompts are well-engineered (consistent behavior)
- ✅ Error messages are clear and actionable
- ✅ Code follows language best practices
- ✅ README enables another developer to run it

---

## Getting Help

### Resources

**Documentation**:
- `FUNCTIONAL-SPEC.md`: System architecture and requirements
- `AGENT-ORCHESTRATION.md`: Agent design patterns
- `CODE.md`: TypeScript reference implementation
- `SCRIPTS.md`: Testing procedures

**Azure Docs**:
- [Azure OpenAI Service](https://learn.microsoft.com/azure/ai-services/openai/)
- [Cosmos DB MongoDB vCore](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/)
- [Managed Identity](https://learn.microsoft.com/azure/active-directory/managed-identities-azure-resources/)

**Framework Docs** (if applicable):
- LangChain: https://langchain.com/docs
- Semantic Kernel: https://learn.microsoft.com/semantic-kernel
- LlamaIndex: https://docs.llamaindex.ai

### Debugging Tips

**If authentication fails**:
1. Check `.env` file has all variables
2. Run `az login` and verify subscription
3. Check RBAC role assignments in Azure Portal
4. Test each service independently

**If vector search returns bad results**:
1. Verify vector index exists
2. Check embedding dimensions match (1536)
3. Test with very specific query first
4. Increase `k` value to see more results

**If agent doesn't call tool**:
1. Check system prompt has "MUST call tool" instruction
2. Add few-shot examples to prompt
3. Enable debug logging to see LLM responses
4. Verify tool schema is properly registered

**If output quality is poor**:
1. Review and refine system prompts
2. Check top 3 search results are actually relevant
3. Add more constraints to synthesizer prompt
4. Test with different k values

---

## Timeline Summary

**Suggested 2-3 Week Plan**:

| Phase | Days | Focus | Key Deliverable |
|-------|------|-------|----------------|
| 1 | 1-2 | Setup & Auth | `test-auth` script |
| 2 | 3-4 | Data Layer | `upload-documents` script |
| 3 | 5-6 | Vector Search | Search function |
| 4 | 7-9 | Planner Agent | Planner with tool calling |
| 5 | 10-11 | Synthesizer | Response generation |
| 6 | 12-13 | Pipeline | `agent` script (E2E) |
| 7 | 14 | Utilities | `cleanup` + polish |

**Flexible Timeline**: Adjust based on team size, experience, and language familiarity. Experienced developers might complete in 7-10 days. Teams learning a new framework might take 3-4 weeks.

---

## Final Notes

### This is a Suggestion

This plan is **one possible approach**. Feel free to:
- Reorder phases based on your workflow
- Combine or split phases as needed
- Use different tools or frameworks
- Add features beyond the spec
- Adapt to your team's process

### Focus on Learning

This project teaches:
- Vector search and embeddings
- RAG (Retrieval-Augmented Generation)
- Agent orchestration patterns
- Azure OpenAI integration
- Cosmos DB MongoDB API
- Passwordless authentication

Take time to understand **why** things work, not just **how** to implement them.

### Iterate and Improve

Start simple, get it working, then optimize:
1. **First**: Make it work (basic functionality)
2. **Second**: Make it right (clean code, error handling)
3. **Third**: Make it fast (optimize performance)
4. **Finally**: Make it robust (comprehensive testing)

Good luck! 🚀
