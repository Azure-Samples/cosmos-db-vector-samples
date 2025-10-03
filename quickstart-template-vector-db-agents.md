# Quickstart: Vector Search in Agentic Workflows with [DATABASE_NAME]

## Overview

This quickstart guide demonstrates how to integrate [DATABASE_NAME] vector search capabilities into agentic workflows. Agents can leverage vector search in two fundamentally different ways:

1. **Deterministic Tool Usage** - Vector search as a structured function/tool that agents call explicitly with specific parameters and receive structured results for decision-making
2. **Context-Aware LLM Enhancement** - Vector search as an invisible background process that automatically retrieves relevant context to enhance LLM responses without the agent explicitly knowing about the search

**Key Differences:**
- **Tool Pattern**: Agent consciously decides to search, controls parameters, and processes structured results
- **Enhancement Pattern**: Search happens transparently; agent only sees the enhanced context in its prompt

## Prerequisites

- [DATABASE_NAME] instance with vector search enabled
- Embedding model (e.g., Azure OpenAI, OpenAI, Hugging Face)
- [LANGUAGE] development environment
- Basic understanding of agent frameworks

## Environment Setup

### 1. Install Dependencies

```bash
# For Python
pip install [database-sdk] openai python-dotenv

# For JavaScript/TypeScript
npm install [database-sdk] openai dotenv
```

### 2. Environment Configuration

Create a `.env` file:

```env
# Database Configuration
DATABASE_CONNECTION_STRING=your_connection_string
DATABASE_NAME=agents_db
COLLECTION_NAME=knowledge_base

# Embedding Model Configuration
OPENAI_API_KEY=your_openai_key
OPENAI_ENDPOINT=your_endpoint  # if using Azure OpenAI
EMBEDDING_MODEL=text-embedding-ada-002
EMBEDDING_DIMENSIONS=1536

# Agent Configuration
SIMILARITY_THRESHOLD=0.8
MAX_SEARCH_RESULTS=5
```

## Core Implementation Patterns

### Pattern 1: Deterministic Vector Search Tool

**Concept**: The agent has explicit control over when and how vector search is performed. It's like giving the agent a "search function" that it can call with specific parameters, and it receives structured results that it can analyze, filter, and use for decision-making.

**When to Use**: 
- When agents need to make decisions based on search results
- When search parameters need to vary based on context
- When you want transparent, debuggable search behavior
- For multi-step reasoning that depends on search results

**Key Characteristics**:
- Agent explicitly calls the search tool
- Receives structured data (scores, metadata, source IDs)
- Can process results before generating responses
- Search parameters are controlled by the agent's logic

#### Implementation

```python
# Python Example - Focus on TOOL INTERFACE
class VectorSearchTool:
    def __init__(self, db_client, embedding_client):
        self.db_client = db_client
        self.embedding_client = embedding_client
        self.collection = db_client[DATABASE_NAME][COLLECTION_NAME]
    
    def search(self, query: str, filter_criteria: dict = None, top_k: int = 5) -> List[dict]:
        """
        TOOL INTERFACE: Returns structured data for agent processing
        
        Returns:
            List of dictionaries with: content, metadata, relevance_score, source_id
        """
        query_embedding = self.embedding_client.embeddings.create(
            input=[query], model=EMBEDDING_MODEL
        ).data[0].embedding
        
        pipeline = [
            {
                "$vectorSearch": {
                    "vector": query_embedding,
                    "path": "embedding",
                    "numCandidates": top_k * 10,
                    "limit": top_k,
                    "index": "vector_index"
                }
            }
        ]
        
        if filter_criteria:
            pipeline.append({"$match": filter_criteria})
        
        pipeline.append({
            "$project": {
                "content": 1,
                "metadata": 1,
                "score": {"$meta": "vectorSearchScore"}
            }
        })
        
        results = list(self.collection.aggregate(pipeline))
        
        # TOOL BEHAVIOR: Return structured data for agent analysis
        return [
            {
                "content": result["content"],
                "metadata": result.get("metadata", {}),
                "relevance_score": result["score"],
                "source_id": str(result["_id"])
            }
            for result in results
        ]

# AGENT USING THE TOOL - Makes explicit decisions based on results
class DecisionMakingAgent:
    def __init__(self, vector_tool, llm_client):
        self.vector_tool = vector_tool
        self.llm_client = llm_client
    
    async def handle_query(self, user_query: str) -> str:
        """
        Agent explicitly controls search and makes decisions based on results
        """
        # EXPLICIT TOOL CALL with agent-controlled parameters
        search_results = self.vector_tool.search(
            query=user_query,
            filter_criteria=self._determine_search_filters(user_query),
            top_k=self._calculate_needed_results(user_query)
        )
        
        # AGENT PROCESSES STRUCTURED RESULTS
        if not search_results:
            return "I couldn't find any relevant information to answer your question."
        
        # Agent analyzes result quality and makes decisions
        high_confidence_results = [
            result for result in search_results 
            if result["relevance_score"] > 0.8
        ]
        
        if not high_confidence_results:
            return f"I found {len(search_results)} potentially relevant sources, but none have high confidence. Would you like me to show them anyway?"
        
        # Agent decides how to use the results
        if len(high_confidence_results) == 1:
            # Single source response
            source = high_confidence_results[0]
            return f"Based on a highly relevant source (confidence: {source['relevance_score']:.2f}): {source['content']}"
        else:
            # Multi-source synthesis
            return await self._synthesize_multiple_sources(high_confidence_results, user_query)
    
    def _determine_search_filters(self, query: str) -> dict:
        """Agent logic determines search parameters"""
        if "recent" in query.lower():
            return {"date": {"$gte": "2024-01-01"}}
        elif "official" in query.lower():
            return {"source_type": "documentation"}
        return {}
    
    def _calculate_needed_results(self, query: str) -> int:
        """Agent decides how many results it needs"""
        if "compare" in query.lower() or "difference" in query.lower():
            return 10  # Need more results for comparison
        return 5  # Standard search
    
    async def _synthesize_multiple_sources(self, results: List[dict], query: str) -> str:
        """Agent processes multiple structured results"""
        sources_text = "\n".join([
            f"Source {i+1} (Score: {result['relevance_score']:.2f}): {result['content'][:200]}..."
            for i, result in enumerate(results)
        ])
        
        response = await self.llm_client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system", 
                    "content": f"Synthesize information from {len(results)} sources to answer the user's question. Each source has a relevance score."
                },
                {
                    "role": "user", 
                    "content": f"Question: {query}\n\nSources:\n{sources_text}"
                }
            ]
        )
        
        return response.choices[0].message.content

# Tool registration for agent frameworks (OpenAI Functions, LangChain Tools, etc.)
def register_vector_search_tool(agent_framework):
    tool = VectorSearchTool(db_client, embedding_client)
    
    agent_framework.register_tool(
        name="search_knowledge_base",
        description="Search the knowledge base for relevant information. Returns structured data with relevance scores.",
        parameters={
            "query": {
                "type": "string", 
                "description": "The search query"
            },
            "filter_criteria": {
                "type": "object", 
                "description": "Optional filters (e.g., {'source_type': 'documentation', 'date': {'$gte': '2024-01-01'}})"
            },
            "top_k": {
                "type": "integer", 
                "description": "Number of results to return (1-20)",
                "default": 5
            }
        },
        function=tool.search
    )
```

```typescript
// TypeScript Example - Tool Pattern
interface SearchResult {
    content: string;
    metadata: Record<string, any>;
    relevanceScore: number;
    sourceId: string;
}

interface SearchFilters {
    dateRange?: { start: string; end: string };
    sourceType?: string;
    department?: string;
}

class VectorSearchTool {
    constructor(
        private dbClient: MongoClient,
        private embeddingClient: OpenAI
    ) {}

    async search(
        query: string, 
        filters?: SearchFilters, 
        topK: number = 5
    ): Promise<SearchResult[]> {
        const embedding = await this.embeddingClient.embeddings.create({
            input: [query],
            model: process.env.EMBEDDING_MODEL!
        });

        const pipeline: any[] = [
            {
                $vectorSearch: {
                    vector: embedding.data[0].embedding,
                    path: "embedding",
                    numCandidates: topK * 10,
                    limit: topK,
                    index: "vector_index"
                }
            }
        ];

        // Apply filters if provided
        if (filters) {
            const matchStage: any = {};
            if (filters.dateRange) {
                matchStage.date = {
                    $gte: filters.dateRange.start,
                    $lte: filters.dateRange.end
                };
            }
            if (filters.sourceType) {
                matchStage.source_type = filters.sourceType;
            }
            if (filters.department) {
                matchStage.department = filters.department;
            }
            
            if (Object.keys(matchStage).length > 0) {
                pipeline.push({ $match: matchStage });
            }
        }

        pipeline.push({
            $project: {
                content: 1,
                metadata: 1,
                score: { $meta: "vectorSearchScore" }
            }
        });

        const collection = this.dbClient.db(process.env.DATABASE_NAME!).collection(process.env.COLLECTION_NAME!);
        const results = await collection.aggregate(pipeline).toArray();

        return results.map(result => ({
            content: result.content,
            metadata: result.metadata || {},
            relevanceScore: result.score,
            sourceId: result._id.toString()
        }));
    }
}

// Agent that makes explicit decisions based on tool results
class AnalyticalAgent {
    constructor(
        private vectorTool: VectorSearchTool,
        private llmClient: OpenAI
    ) {}

    async analyzeQuery(userQuery: string, userContext: any): Promise<any> {
        // Agent decides search strategy based on query analysis
        const searchStrategy = this.determineSearchStrategy(userQuery);
        
        // Execute search with agent-determined parameters
        const results = await this.vectorTool.search(
            userQuery,
            searchStrategy.filters,
            searchStrategy.maxResults
        );

        // Agent analyzes and categorizes results
        const analysis = this.analyzeResults(results);
        
        // Agent makes decisions based on analysis
        if (analysis.highConfidenceCount === 0) {
            return {
                response: "I found some potentially relevant information, but confidence is low. Would you like me to search with different parameters?",
                confidence: "low",
                suggestedActions: ["refine_query", "expand_search", "try_different_keywords"]
            };
        }

        // Agent decides response format based on result analysis
        if (analysis.sourceTypes.length > 1) {
            return await this.generateComparativeResponse(results, userQuery);
        } else {
            return await this.generateDirectResponse(results, userQuery);
        }
    }

    private determineSearchStrategy(query: string): { filters: SearchFilters; maxResults: number } {
        // Agent logic for search strategy
        const strategy: { filters: SearchFilters; maxResults: number } = {
            filters: {},
            maxResults: 5
        };

        if (query.toLowerCase().includes("recent") || query.toLowerCase().includes("latest")) {
            strategy.filters.dateRange = {
                start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                end: new Date().toISOString().split('T')[0]
            };
        }

        if (query.toLowerCase().includes("compare") || query.toLowerCase().includes("vs")) {
            strategy.maxResults = 10; // Need more results for comparison
        }

        return strategy;
    }

    private analyzeResults(results: SearchResult[]): any {
        return {
            totalCount: results.length,
            highConfidenceCount: results.filter(r => r.relevanceScore > 0.8).length,
            averageScore: results.reduce((sum, r) => sum + r.relevanceScore, 0) / results.length,
            sourceTypes: [...new Set(results.map(r => r.metadata.source_type))],
            topScore: results.length > 0 ? results[0].relevanceScore : 0
        };
    }
}
```

### Pattern 2: Context-Aware LLM Enhancement

**Concept**: Vector search happens transparently in the background to automatically enhance the LLM's context. The agent doesn't explicitly call search or see search results - it just gets enhanced prompts with relevant information seamlessly injected.

**When to Use**:
- When you want natural, conversational responses
- When search should be invisible to the agent
- For general-purpose chatbots and assistants
- When you want to automatically augment any query with relevant context

**Key Characteristics**:
- Search happens automatically for every query
- Agent never sees search results directly
- Context is injected into the system prompt
- Focus is on natural language enhancement, not structured data processing

#### Implementation

```python
# Python Example - Focus on TRANSPARENT ENHANCEMENT
class ContextEnhancementService:
    """
    Service that transparently enhances LLM context with vector search
    Agent never directly interacts with this service
    """
    def __init__(self, db_client, embedding_client):
        self.db_client = db_client
        self.embedding_client = embedding_client
        self.collection = db_client[DATABASE_NAME][COLLECTION_NAME]
    
    async def enhance_context(self, user_query: str, conversation_history: List[str] = None) -> str:
        """
        TRANSPARENT ENHANCEMENT: Returns enhanced context string, not structured data
        """
        # Automatically determine what to search for
        search_query = self._extract_search_intent(user_query, conversation_history)
        
        # Perform search (agent doesn't know this is happening)
        query_embedding = await self.embedding_client.embeddings.create(
            input=[search_query], model=EMBEDDING_MODEL
        )
        
        pipeline = [
            {
                "$vectorSearch": {
                    "vector": query_embedding.data[0].embedding,
                    "path": "embedding",
                    "numCandidates": 30,
                    "limit": 3,  # Keep context focused
                    "index": "vector_index"
                }
            },
            {
                "$project": {
                    "content": 1,
                    "metadata": 1,
                    "score": {"$meta": "vectorSearchScore"}
                }
            }
        ]
        
        results = list(self.collection.aggregate(pipeline))
        
        # ENHANCEMENT BEHAVIOR: Convert to natural language context
        return self._build_natural_context(results, user_query)
    
    def _extract_search_intent(self, user_query: str, history: List[str] = None) -> str:
        """
        Automatically determine what to search for without agent input
        """
        # Combine recent conversation context
        context_window = []
        if history:
            context_window.extend(history[-3:])  # Last 3 exchanges
        context_window.append(user_query)
        
        # Return enhanced search query
        return " ".join(context_window)
    
    def _build_natural_context(self, results: List[dict], original_query: str) -> str:
        """
        ENHANCEMENT FOCUS: Build natural language context, not structured data
        """
        if not results:
            return "No specific context available."
        
        # Filter by relevance threshold automatically
        relevant_results = [r for r in results if r.get("score", 0) > 0.7]
        
        if not relevant_results:
            return "General knowledge available, but no highly specific context found."
        
        # Build natural language context
        context_parts = []
        for result in relevant_results:
            content = result["content"]
            # Automatically summarize if too long
            if len(content) > 300:
                content = content[:300] + "..."
            context_parts.append(content)
        
        return "\n\n".join(context_parts)

class EnhancedConversationalAgent:
    """
    Agent that gets enhanced context transparently
    No knowledge of vector search - just gets better context
    """
    def __init__(self, llm_client, enhancement_service):
        self.llm_client = llm_client
        self.enhancement_service = enhancement_service
        self.conversation_history = []
    
    async def chat(self, user_message: str) -> str:
        """
        TRANSPARENT ENHANCEMENT: Agent just chats, context is enhanced automatically
        """
        # Enhancement happens transparently
        enhanced_context = await self.enhancement_service.enhance_context(
            user_message, 
            self.conversation_history
        )
        
        # Agent just sees enhanced system prompt - no knowledge of search
        system_prompt = f"""
        You are a helpful assistant. Answer the user's question naturally and conversationally.
        
        Relevant context (use naturally, don't mention this is from a search):
        {enhanced_context}
        
        If the context isn't relevant to the question, just answer based on your general knowledge.
        """
        
        response = await self.llm_client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7
        )
        
        response_text = response.choices[0].message.content
        
        # Update conversation history for future context enhancement
        self.conversation_history.extend([user_message, response_text])
        
        # Keep history manageable
        if len(self.conversation_history) > 10:
            self.conversation_history = self.conversation_history[-10:]
        
        return response_text

# Usage - Agent has no knowledge of vector search
async def simple_usage_example():
    enhancement_service = ContextEnhancementService(db_client, embedding_client)
    agent = EnhancedConversationalAgent(llm_client, enhancement_service)
    
    # Agent just chats - enhancement is completely transparent
    response1 = await agent.chat("How do I optimize database performance?")
    print(response1)  # Response is automatically enhanced with relevant docs
    
    response2 = await agent.chat("What about indexing strategies?")
    print(response2)  # Context includes previous conversation + new relevant docs
```

```typescript
// TypeScript Example - Enhancement Pattern
class ContextEnhancementService {
    constructor(
        private dbClient: MongoClient,
        private embeddingClient: OpenAI
    ) {}

    async enhanceContext(
        userQuery: string, 
        conversationHistory: string[] = []
    ): Promise<string> {
        // Automatically determine search strategy
        const searchContext = this.buildSearchContext(userQuery, conversationHistory);
        
        // Transparent search
        const embedding = await this.embeddingClient.embeddings.create({
            input: [searchContext],
            model: process.env.EMBEDDING_MODEL!
        });

        const pipeline = [
            {
                $vectorSearch: {
                    vector: embedding.data[0].embedding,
                    path: "embedding",
                    numCandidates: 20,
                    limit: 3,
                    index: "vector_index"
                }
            },
            {
                $project: {
                    content: 1,
                    metadata: 1,
                    score: { $meta: "vectorSearchScore" }
                }
            }
        ];

        const collection = this.dbClient.db(process.env.DATABASE_NAME!).collection(process.env.COLLECTION_NAME!);
        const results = await collection.aggregate(pipeline).toArray();

        return this.buildNaturalContext(results);
    }

    private buildSearchContext(query: string, history: string[]): string {
        // Automatically enhance search with conversation context
        const recentHistory = history.slice(-4); // Last 2 exchanges
        return [...recentHistory, query].join(" ");
    }

    private buildNaturalContext(results: any[]): string {
        const relevantResults = results.filter(r => r.score > 0.75);
        
        if (relevantResults.length === 0) {
            return "No specific documentation available for this topic.";
        }

        // Convert to natural language context
        const contextSections = relevantResults.map(result => {
            let content = result.content;
            // Auto-truncate long content
            if (content.length > 250) {
                content = content.substring(0, 250) + "...";
            }
            return content;
        });

        return contextSections.join("\n\n");
    }
}

class StreamlinedChatAgent {
    private conversationHistory: string[] = [];

    constructor(
        private llmClient: OpenAI,
        private enhancementService: ContextEnhancementService
    ) {}

    async respondTo(userMessage: string): Promise<string> {
        // Automatic context enhancement - agent doesn't control this
        const enhancedContext = await this.enhancementService.enhanceContext(
            userMessage,
            this.conversationHistory
        );

        // Agent just gets enhanced prompt
        const systemPrompt = `
        You are a friendly and knowledgeable assistant. Respond naturally and helpfully.
        
        Additional context (integrate naturally into your response):
        ${enhancedContext}
        
        Answer the user's question in a conversational way. Don't mention that you searched for information.
        `;

        const response = await this.llmClient.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        const responseText = response.choices[0].message.content || "I couldn't generate a response.";

        // Update history for future context enhancement
        this.conversationHistory.push(userMessage, responseText);
        
        // Maintain reasonable history size
        if (this.conversationHistory.length > 12) {
            this.conversationHistory = this.conversationHistory.slice(-12);
        }

        return responseText;
    }

    // Agent can have other methods that don't involve search at all
    async clarifyQuestion(userMessage: string): Promise<string> {
        const response = await this.llmClient.chat.completions.create({
            model: "gpt-4",
            messages: [
                { 
                    role: "system", 
                    content: "Ask clarifying questions to help the user be more specific." 
                },
                { role: "user", content: userMessage }
            ],
            temperature: 0.8
        });

        return response.choices[0].message.content || "Could you provide more details?";
    }
}

// Framework integration - Enhancement happens at the middleware level
class ChatbotWithEnhancement {
    constructor(
        private agent: StreamlinedChatAgent
    ) {}

    async handleUserInput(input: string): Promise<{ response: string; sources?: string[] }> {
        // All responses are automatically enhanced
        const response = await this.agent.respondTo(input);
        
        return {
            response,
            // Enhancement pattern doesn't expose sources to the end user
            // Focus is on natural conversation
        };
    }
}
```

**Key Differences Illustrated:**

```python
# TOOL PATTERN - Agent controls and processes search
class ToolBasedAgent:
    async def answer_question(self, query: str) -> str:
        # 1. Agent decides to search
        results = self.search_tool.search(query, top_k=5)
        
        # 2. Agent analyzes structured results
        if not results or results[0]["relevance_score"] < 0.7:
            return "No reliable information found"
        
        # 3. Agent processes and decides how to use results
        high_quality_sources = [r for r in results if r["relevance_score"] > 0.8]
        return f"Based on {len(high_quality_sources)} sources: {self.synthesize(high_quality_sources)}"

# ENHANCEMENT PATTERN - Search is invisible
class EnhancedAgent:
    async def answer_question(self, query: str) -> str:
        # Search happens automatically in the background
        # Agent just responds naturally with enhanced context
        return await self.llm_client.chat.completions.create(
            messages=[
                {"role": "system", "content": await self.get_enhanced_prompt(query)},
                {"role": "user", "content": query}
            ]
        )
```

## Advanced Patterns

### 1. Hierarchical Search with Metadata Filtering

**Use Case**: Multi-tenant applications, role-based access control, or domain-specific knowledge retrieval where agents need to respect user permissions and context.

**Agent Integration**: This pattern is ideal for enterprise agents that serve multiple users with different access levels or specialized knowledge domains.

```python
class HierarchicalSearchAgent:
    def __init__(self, vector_tool, permission_service):
        self.vector_tool = vector_tool
        self.permission_service = permission_service
    
    async def search_with_context(self, query: str, user_id: str, domain: str = None) -> List[dict]:
        """
        Agent method that performs context-aware hierarchical search
        """
        # Get user context and permissions
        user_context = await self.permission_service.get_user_context(user_id)
        
        return await self.hierarchical_search(query, user_context, domain)
    
    async def hierarchical_search(self, query: str, user_context: dict, domain: str = None) -> List[dict]:
        """
        Perform hierarchical search with user context
        """
        # Level 1: Broad semantic search with domain filtering
        search_filters = {}
        if domain:
            search_filters["domain"] = domain
            
        broad_results = await self.vector_tool.search(query, filter_criteria=search_filters, top_k=20)
        
        # Level 2: Filter by user permissions/context
        filtered_results = [
            result for result in broad_results
            if self._check_user_permissions(result["metadata"], user_context)
        ]
        
        # Level 3: Re-rank by relevance + recency + user preferences
        final_results = self._rerank_by_composite_score(
            filtered_results, 
            user_context,
            relevance_weight=0.5, 
            recency_weight=0.3,
            user_preference_weight=0.2
        )
        
        return final_results[:5]
    
    def _check_user_permissions(self, metadata: dict, user_context: dict) -> bool:
        """Check if user has access to this content"""
        required_clearance = metadata.get("clearance_level", "public")
        user_clearance = user_context.get("clearance_level", "public")
        
        # Simple clearance hierarchy
        clearance_levels = {"public": 0, "internal": 1, "confidential": 2, "secret": 3}
        
        return clearance_levels.get(user_clearance, 0) >= clearance_levels.get(required_clearance, 0)
    
    def _rerank_by_composite_score(self, results: List[dict], user_context: dict, **weights) -> List[dict]:
        """Re-rank results using multiple factors"""
        from datetime import datetime
        
        current_time = datetime.now()
        user_interests = user_context.get("interests", [])
        
        for result in results:
            # Original relevance score
            relevance_score = result["relevance_score"]
            
            # Recency score (newer is better)
            created_date = datetime.fromisoformat(result["metadata"].get("created_date", "2020-01-01"))
            days_old = (current_time - created_date).days
            recency_score = max(0, 1 - (days_old / 365))  # Decay over a year
            
            # User preference score
            content_tags = result["metadata"].get("tags", [])
            preference_score = len(set(content_tags) & set(user_interests)) / max(len(user_interests), 1)
            
            # Composite score
            result["composite_score"] = (
                relevance_score * weights["relevance_weight"] +
                recency_score * weights["recency_weight"] +
                preference_score * weights["user_preference_weight"]
            )
        
        return sorted(results, key=lambda x: x["composite_score"], reverse=True)

# Agent framework integration example
class EnterpriseAgent:
    def __init__(self):
        self.hierarchical_search = HierarchicalSearchAgent(vector_tool, permission_service)
    
    async def handle_user_query(self, query: str, user_id: str, session_context: dict) -> str:
        """
        Main agent method that uses hierarchical search
        """
        # Extract domain from session context or query
        domain = session_context.get("current_domain") or self._extract_domain_from_query(query)
        
        # Perform context-aware search
        search_results = await self.hierarchical_search.search_with_context(
            query, user_id, domain
        )
        
        if not search_results:
            return "I don't have access to information that can answer your question."
        
        # Generate response with found context
        context_prompt = self._build_context_prompt(search_results, user_id)
        return await self._generate_contextualized_response(query, context_prompt)
    
    def _extract_domain_from_query(self, query: str) -> str:
        """Extract domain from query using keywords or NLP"""
        domain_keywords = {
            "finance": ["budget", "cost", "revenue", "financial"],
            "hr": ["employee", "hiring", "benefits", "policy"],
            "technical": ["API", "database", "server", "code"]
        }
        
        query_lower = query.lower()
        for domain, keywords in domain_keywords.items():
            if any(keyword in query_lower for keyword in keywords):
                return domain
        
        return "general"
```

### 2. Multi-Modal Vector Search

**Use Case**: Agents that need to process and search across different types of content (text, images, audio) or when users provide mixed-media queries.

**Agent Integration**: Perfect for customer support agents, content discovery systems, or research assistants that work with rich media.

```python
class MultiModalSearchAgent:
    def __init__(self, vector_tool, vision_client, audio_client):
        self.vector_tool = vector_tool
        self.vision_client = vision_client
        self.audio_client = audio_client
    
    async def search_mixed_media(self, 
                                text_query: str = None, 
                                image_data: bytes = None, 
                                audio_data: bytes = None,
                                media_weights: dict = None) -> List[dict]:
        """
        Agent method for searching across multiple modalities
        """
        if not any([text_query, image_data, audio_data]):
            raise ValueError("At least one search input must be provided")
        
        # Default weights for different modalities
        default_weights = {"text": 0.5, "image": 0.3, "audio": 0.2}
        weights = media_weights or default_weights
        
        return await self.multi_modal_search(text_query, image_data, audio_data, weights)
    
    async def multi_modal_search(self, text_query: str, image_data: bytes, audio_data: bytes, weights: dict) -> List[dict]:
        """
        Search using multiple embedding types with weighted scoring
        """
        search_results = {}
        
        # Text embedding search
        if text_query and weights.get("text", 0) > 0:
            text_embedding = await self._get_text_embedding(text_query)
            text_results = await self._search_by_embedding(text_embedding, "text_embedding", top_k=15)
            search_results["text"] = text_results
        
        # Image embedding search
        if image_data and weights.get("image", 0) > 0:
            image_embedding = await self._get_image_embedding(image_data)
            image_results = await self._search_by_embedding(image_embedding, "image_embedding", top_k=15)
            search_results["image"] = image_results
        
        # Audio embedding search
        if audio_data and weights.get("audio", 0) > 0:
            audio_embedding = await self._get_audio_embedding(audio_data)
            audio_results = await self._search_by_embedding(audio_embedding, "audio_embedding", top_k=15)
            search_results["audio"] = audio_results
        
        # Merge and rank results
        return self._merge_multimodal_results(search_results, weights)
    
    async def _get_text_embedding(self, text: str) -> List[float]:
        """Generate text embedding"""
        response = await self.vector_tool.embedding_client.embeddings.create(
            input=[text],
            model="text-embedding-ada-002"
        )
        return response.data[0].embedding
    
    async def _get_image_embedding(self, image_data: bytes) -> List[float]:
        """Generate image embedding using vision model"""
        # This would use a vision model like CLIP
        return await self.vision_client.encode_image(image_data)
    
    async def _get_audio_embedding(self, audio_data: bytes) -> List[float]:
        """Generate audio embedding"""
        # This would use an audio model like Wav2Vec2
        return await self.audio_client.encode_audio(audio_data)
    
    async def _search_by_embedding(self, embedding: List[float], field: str, top_k: int) -> List[dict]:
        """Search using specific embedding field"""
        pipeline = [
            {
                "$vectorSearch": {
                    "vector": embedding,
                    "path": field,
                    "numCandidates": top_k * 2,
                    "limit": top_k,
                    "index": f"{field}_index"
                }
            },
            {
                "$project": {
                    "content": 1,
                    "metadata": 1,
                    "score": {"$meta": "vectorSearchScore"},
                    "modality": {"$literal": field.replace("_embedding", "")}
                }
            }
        ]
        
        collection = self.vector_tool.db_client.db(DATABASE_NAME).collection(COLLECTION_NAME)
        return await collection.aggregate(pipeline).to_list(length=top_k)
    
    def _merge_multimodal_results(self, search_results: dict, weights: dict) -> List[dict]:
        """Merge and rank results from different modalities"""
        merged_results = {}
        
        # Combine results from all modalities
        for modality, results in search_results.items():
            weight = weights.get(modality, 0)
            
            for result in results:
                doc_id = str(result["_id"])
                
                if doc_id not in merged_results:
                    merged_results[doc_id] = {
                        "content": result["content"],
                        "metadata": result["metadata"],
                        "modality_scores": {},
                        "composite_score": 0
                    }
                
                # Weight the score by modality importance
                weighted_score = result["score"] * weight
                merged_results[doc_id]["modality_scores"][modality] = result["score"]
                merged_results[doc_id]["composite_score"] += weighted_score
        
        # Convert to list and sort by composite score
        final_results = list(merged_results.values())
        return sorted(final_results, key=lambda x: x["composite_score"], reverse=True)

# Agent framework integration for multi-modal queries
class MultiModalAssistant:
    def __init__(self):
        self.multimodal_search = MultiModalSearchAgent(vector_tool, vision_client, audio_client)
    
    async def handle_multimodal_query(self, query_data: dict) -> str:
        """
        Handle queries that may contain text, images, and/or audio
        """
        text_query = query_data.get("text")
        image_data = query_data.get("image")
        audio_data = query_data.get("audio")
        
        # Determine query intent and adjust weights accordingly
        if image_data and not text_query:
            # Image-first query
            weights = {"image": 0.7, "text": 0.3, "audio": 0.0}
        elif audio_data and not text_query:
            # Audio-first query
            weights = {"audio": 0.6, "text": 0.4, "image": 0.0}
        else:
            # Text-first or balanced query
            weights = {"text": 0.5, "image": 0.3, "audio": 0.2}
        
        # Perform multi-modal search
        results = await self.multimodal_search.search_mixed_media(
            text_query=text_query,
            image_data=image_data,
            audio_data=audio_data,
            media_weights=weights
        )
        
        # Generate contextual response
        return await self._generate_multimodal_response(query_data, results)
    
    async def _generate_multimodal_response(self, query_data: dict, search_results: List[dict]) -> str:
        """Generate response acknowledging different input modalities"""
        context_parts = []
        
        for result in search_results[:3]:  # Top 3 results
            modalities = list(result["modality_scores"].keys())
            context_parts.append(f"""
            Content: {result['content']}
            (Found via: {', '.join(modalities)} similarity)
            Relevance: {result['composite_score']:.3f}
            """)
        
        context = "\n".join(context_parts)
        
        # Create mode-aware prompt
        input_types = []
        if query_data.get("text"):
            input_types.append("text")
        if query_data.get("image"):
            input_types.append("image")
        if query_data.get("audio"):
            input_types.append("audio")
        
        system_prompt = f"""
        You are processing a multi-modal query with {', '.join(input_types)} inputs.
        Use the following context found through cross-modal search to provide a comprehensive answer.
        
        Context:
        {context}
        """
        
        return await self._call_llm(system_prompt, query_data.get("text", "Please analyze the provided media."))
```

### 3. Real-time Knowledge Updates and Adaptive Learning

**Use Case**: Agents that need to stay current with rapidly changing information or learn from user interactions to improve future responses.

**Agent Integration**: Essential for news agents, market analysis agents, or customer support agents that need to incorporate new policies or procedures in real-time.

```python
class AdaptiveKnowledgeAgent:
    def __init__(self, vector_tool, knowledge_updater, feedback_collector):
        self.vector_tool = vector_tool
        self.knowledge_updater = knowledge_updater
        self.feedback_collector = feedback_collector
        self.knowledge_cache = {}
        self.last_update = datetime.now()
        self.query_patterns = defaultdict(int)  # Track query patterns
        self.feedback_scores = {}  # Track response quality
    
    async def respond_with_adaptive_knowledge(self, 
                                            query: str, 
                                            user_id: str, 
                                            session_id: str) -> dict:
        """
        Agent method that adapts knowledge based on usage patterns and feedback
        """
        # Track query patterns for learning
        query_signature = self._get_query_signature(query)
        self.query_patterns[query_signature] += 1
        
        # Check if knowledge needs updating
        should_update = await self._should_refresh_knowledge(query, user_id)
        
        if should_update:
            await self._update_vector_store(query, user_id)
        
        # Perform context-aware search with learning bias
        context = await self._adaptive_search(query, user_id, session_id)
        
        # Generate response with confidence scoring
        response_data = await self._generate_response_with_confidence(query, context)
        
        # Set up feedback collection
        response_data["feedback_token"] = self._create_feedback_token(query, response_data["response"], session_id)
        
        return response_data
    
    async def _should_refresh_knowledge(self, query: str, user_id: str) -> bool:
        """
        Intelligent decision on whether to refresh knowledge
        """
        # Time-based refresh
        time_since_update = datetime.now() - self.last_update
        if time_since_update > timedelta(hours=1):
            return True
        
        # Query novelty detection
        if self._is_novel_query(query):
            return True
        
        # User-specific patterns
        if await self._has_user_preference_changed(user_id):
            return True
        
        # Domain-specific update triggers
        if await self._check_domain_update_triggers(query):
            return True
        
        return False
    
    def _is_novel_query(self, query: str) -> bool:
        """Detect if this is a novel type of query"""
        query_signature = self._get_query_signature(query)
        
        # If we've seen this pattern less than 3 times, consider it novel
        return self.query_patterns[query_signature] < 3
    
    def _get_query_signature(self, query: str) -> str:
        """Create a signature for query pattern recognition"""
        # Simple approach: extract key entities and intent
        # In production, you'd use more sophisticated NLP
        import re
        
        # Extract entities (simplified)
        entities = re.findall(r'\b[A-Z][a-z]+\b', query)
        
        # Extract question words
        question_words = re.findall(r'\b(what|when|where|why|how|who)\b', query.lower())
        
        # Create signature
        signature = f"entities:{','.join(sorted(entities))}_questions:{','.join(sorted(question_words))}"
        return signature
    
    async def _adaptive_search(self, query: str, user_id: str, session_id: str) -> List[dict]:
        """
        Search that adapts based on user feedback and success patterns
        """
        # Get user's historical preferences
        user_preferences = await self._get_user_search_preferences(user_id)
        
        # Adjust search parameters based on previous feedback
        search_params = self._calculate_adaptive_search_params(query, user_preferences)
        
        # Perform search with learned biases
        results = await self.vector_tool.search(
            query,
            top_k=search_params["top_k"],
            filter_criteria=search_params["filters"]
        )
        
        # Re-rank based on user feedback patterns
        return self._rerank_by_user_feedback(results, user_id, query)
    
    async def _get_user_search_preferences(self, user_id: str) -> dict:
        """Get learned preferences for this user"""
        # This would query a user preference store
        return {
            "preferred_content_types": ["documentation", "examples"],
            "feedback_scores": self.feedback_scores.get(user_id, {}),
            "successful_query_patterns": []
        }
    
    def _calculate_adaptive_search_params(self, query: str, user_preferences: dict) -> dict:
        """Calculate search parameters based on learned patterns"""
        base_params = {"top_k": 5, "filters": {}}
        
        # Adjust based on query complexity
        query_complexity = len(query.split())
        if query_complexity > 10:
            base_params["top_k"] = 8  # More results for complex queries
        
        # Adjust based on user preferences
        preferred_types = user_preferences.get("preferred_content_types", [])
        if preferred_types:
            base_params["filters"]["content_type"] = {"$in": preferred_types}
        
        return base_params
    
    def _rerank_by_user_feedback(self, results: List[dict], user_id: str, query: str) -> List[dict]:
        """Re-rank results based on historical user feedback"""
        user_feedback = self.feedback_scores.get(user_id, {})
        
        for result in results:
            # Boost content that has received positive feedback from this user
            content_id = result["metadata"].get("content_id")
            if content_id in user_feedback:
                feedback_boost = user_feedback[content_id] * 0.1  # Scale feedback impact
                result["relevance_score"] = min(1.0, result["relevance_score"] + feedback_boost)
        
        return sorted(results, key=lambda x: x["relevance_score"], reverse=True)
    
    async def _generate_response_with_confidence(self, query: str, context: List[dict]) -> dict:
        """Generate response with confidence scoring"""
        if not context:
            return {
                "response": "I don't have enough information to answer that question.",
                "confidence": 0.1,
                "sources": []
            }
        
        # Calculate confidence based on context quality
        avg_relevance = sum(item["relevance_score"] for item in context) / len(context)
        context_coverage = min(1.0, len(context) / 3)  # Ideal is 3+ sources
        
        confidence = (avg_relevance * 0.7) + (context_coverage * 0.3)
        
        # Generate response
        context_text = "\n".join([item["content"] for item in context[:3]])
        
        system_prompt = f"""
        Generate a response based on the following context. Be honest about limitations.
        Your confidence in this response is {confidence:.2f}.
        
        Context:
        {context_text}
        """
        
        response = await self._call_llm(system_prompt, query)
        
        return {
            "response": response,
            "confidence": confidence,
            "sources": [{"content": item["content"][:100] + "...", 
                        "score": item["relevance_score"]} for item in context[:3]]
        }
    
    def _create_feedback_token(self, query: str, response: str, session_id: str) -> str:
        """Create a token for tracking feedback"""
        import hashlib
        
        feedback_data = f"{query}:{response}:{session_id}:{datetime.now().isoformat()}"
        return hashlib.md5(feedback_data.encode()).hexdigest()[:12]
    
    async def process_user_feedback(self, feedback_token: str, rating: int, user_id: str):
        """Process user feedback to improve future responses"""
        # Store feedback for learning
        if user_id not in self.feedback_scores:
            self.feedback_scores[user_id] = {}
        
        # Update user's feedback history
        # In production, you'd store this persistently
        feedback_entry = {
            "token": feedback_token,
            "rating": rating,
            "timestamp": datetime.now(),
        }
        
        # Trigger knowledge updates if negative feedback
        if rating < 3:  # Poor rating
            await self._investigate_poor_response(feedback_token, user_id)
    
    async def _investigate_poor_response(self, feedback_token: str, user_id: str):
        """Investigate and learn from poor responses"""
        # This would trigger a more detailed analysis and potential knowledge update
        print(f"Investigating poor response for user {user_id}, token {feedback_token}")
        
        # Could trigger:
        # - Re-evaluation of search parameters
        # - Knowledge base updates
        # - Query understanding improvements

# Complete agent implementation
class LearningAssistantAgent:
    def __init__(self):
        self.adaptive_knowledge = AdaptiveKnowledgeAgent(
            vector_tool, knowledge_updater, feedback_collector
        )
        self.conversation_history = {}
    
    async def chat(self, message: str, user_id: str, session_id: str) -> dict:
        """
        Main chat interface with adaptive learning
        """
        # Get adaptive response
        response_data = await self.adaptive_knowledge.respond_with_adaptive_knowledge(
            message, user_id, session_id
        )
        
        # Store conversation for context
        if session_id not in self.conversation_history:
            self.conversation_history[session_id] = []
        
        self.conversation_history[session_id].append({
            "user_message": message,
            "assistant_response": response_data["response"],
            "confidence": response_data["confidence"],
            "timestamp": datetime.now()
        })
        
        return {
            "response": response_data["response"],
            "confidence": response_data["confidence"],
            "sources": response_data["sources"],
            "feedback_token": response_data["feedback_token"],
            "suggestions": self._generate_follow_up_suggestions(message, response_data)
        }
    
    async def provide_feedback(self, feedback_token: str, rating: int, user_id: str):
        """Allow users to provide feedback on responses"""
        await self.adaptive_knowledge.process_user_feedback(feedback_token, rating, user_id)
        
        return {"message": "Thank you for your feedback! I'll use it to improve future responses."}
    
    def _generate_follow_up_suggestions(self, original_query: str, response_data: dict) -> List[str]:
        """Generate follow-up question suggestions"""
        confidence = response_data["confidence"]
        
        if confidence < 0.5:
            return [
                "Could you provide more specific details about what you're looking for?",
                "Would you like me to search for related topics?",
                "Is there a particular aspect of this topic you'd like me to focus on?"
            ]
        else:
            # Generate topic-specific follow-ups
            return [
                "Would you like more detailed information about any of these points?",
                "Are there related topics you'd like to explore?",
                "Would examples or case studies be helpful?"
            ]
```

These enhanced advanced patterns now include:

1. **Complete Agent Integration**: Each pattern shows how to integrate with actual agent frameworks
2. **Practical Use Cases**: Clear explanations of when and why to use each pattern
3. **Error Handling**: Robust error handling and fallback mechanisms
4. **User Context**: How agents maintain and use user context across interactions
5. **Feedback Loops**: How agents learn and improve from user interactions
6. **Performance Considerations**: Caching, optimization, and scalability aspects
7. **Real-world Examples**: Complete implementations that could be used in production

The patterns now demonstrate how vector search isn't just a tool that agents call, but an integral part of intelligent, adaptive agent behavior that learns and improves over time.

## Error Handling and Performance

### Robust Error Handling

```python
class ResilientVectorSearch:
    def __init__(self, primary_db, fallback_db=None):
        self.primary_db = primary_db
        self.fallback_db = fallback_db
        self.circuit_breaker = CircuitBreaker()
    
    async def search_with_fallback(self, query: str) -> List[dict]:
        """
        Search with fallback and circuit breaker pattern
        """
        try:
            if self.circuit_breaker.is_open():
                return await self._fallback_search(query)
            
            return await self._primary_search(query)
            
        except DatabaseTimeoutError:
            self.circuit_breaker.record_failure()
            return await self._fallback_search(query)
        
        except EmbeddingError as e:
            # Retry with different embedding strategy
            return await self._retry_with_cached_embeddings(query)
    
    async def _fallback_search(self, query: str) -> List[dict]:
        """
        Fallback to secondary search method
        """
        if self.fallback_db:
            return await self.fallback_db.search(query)
        else:
            # Use keyword search as ultimate fallback
            return await self._keyword_search(query)
```

### Performance Optimization

```python
class OptimizedVectorAgent:
    def __init__(self):
        self.embedding_cache = LRUCache(maxsize=1000)
        self.result_cache = TTLCache(maxsize=500, ttl=300)  # 5-minute TTL
    
    async def cached_search(self, query: str) -> List[dict]:
        """
        Search with multi-level caching
        """
        # Check result cache first
        cache_key = hashlib.md5(query.encode()).hexdigest()
        if cache_key in self.result_cache:
            return self.result_cache[cache_key]
        
        # Get or create embedding
        embedding = await self._get_cached_embedding(query)
        
        # Perform search
        results = await self._search_with_embedding(embedding)
        
        # Cache results
        self.result_cache[cache_key] = results
        return results
    
    async def _get_cached_embedding(self, text: str) -> List[float]:
        """
        Get embedding with caching
        """
        if text in self.embedding_cache:
            return self.embedding_cache[text]
        
        embedding = await self.embedding_client.create_embedding(text)
        self.embedding_cache[text] = embedding
        return embedding
```

## Testing Strategies

### Unit Testing

```python
import pytest
from unittest.mock import Mock, AsyncMock

class TestVectorSearchTool:
    @pytest.fixture
    def mock_vector_tool(self):
        tool = VectorSearchTool(Mock(), Mock())
        tool.collection = Mock()
        return tool
    
    @pytest.mark.asyncio
    async def test_search_returns_formatted_results(self, mock_vector_tool):
        # Arrange
        mock_results = [
            {"content": "test content", "score": 0.9, "_id": "123"}
        ]
        mock_vector_tool.collection.aggregate.return_value = mock_results
        
        # Act
        results = await mock_vector_tool.search("test query")
        
        # Assert
        assert len(results) == 1
        assert results[0]["content"] == "test content"
        assert results[0]["relevance_score"] == 0.9
    
    @pytest.mark.asyncio
    async def test_search_handles_empty_results(self, mock_vector_tool):
        # Arrange
        mock_vector_tool.collection.aggregate.return_value = []
        
        # Act
        results = await mock_vector_tool.search("nonexistent query")
        
        # Assert
        assert results == []
```

### Integration Testing

```python
class TestAgentIntegration:
    @pytest.mark.asyncio
    async def test_end_to_end_agent_response(self):
        # Setup test database with known data
        test_docs = [
            {"content": "Vector search is fast", "embedding": [0.1, 0.2, 0.3]},
            {"content": "Databases store data", "embedding": [0.4, 0.5, 0.6]}
        ]
        await self.test_collection.insert_many(test_docs)
        
        # Test agent response
        agent = ContextualAgent(self.db_client, self.embedding_client, self.llm_client)
        response = await agent.generate_response("How fast is vector search?")
        
        # Verify response contains expected context
        assert "Vector search is fast" in response
```

## Monitoring and Observability

### Metrics Collection

```python
from prometheus_client import Counter, Histogram, Gauge

# Define metrics
vector_search_requests = Counter('vector_search_requests_total', 'Total vector search requests', ['status'])
vector_search_duration = Histogram('vector_search_duration_seconds', 'Vector search duration')
active_agent_sessions = Gauge('active_agent_sessions', 'Number of active agent sessions')

class MonitoredVectorAgent:
    def __init__(self):
        self.vector_tool = VectorSearchTool()
    
    async def search_with_monitoring(self, query: str) -> List[dict]:
        """
        Search with monitoring and metrics collection
        """
        start_time = time.time()
        
        try:
            results = await self.vector_tool.search(query)
            vector_search_requests.labels(status='success').inc()
            return results
            
        except Exception as e:
            vector_search_requests.labels(status='error').inc()
            logger.error(f"Vector search failed: {e}", extra={
                "query": query,
                "error_type": type(e).__name__
            })
            raise
            
        finally:
            duration = time.time() - start_time
            vector_search_duration.observe(duration)
```

## Best Practices

### 1. Query Optimization
- **Specific queries**: Use specific, well-formed queries for better results
- **Query preprocessing**: Clean and normalize queries before embedding
- **Context injection**: Include relevant metadata in queries

### 2. Embedding Strategy
- **Consistent models**: Use the same embedding model for indexing and querying
- **Embedding dimensions**: Match vector dimensions between data and queries
- **Model versioning**: Version your embedding models for reproducibility

### 3. Index Management
- **Index selection**: Choose appropriate index types (HNSW, IVF, DiskANN) based on your use case
- **Index parameters**: Tune index parameters for your specific performance requirements
- **Index maintenance**: Regularly update indexes as data grows

### 4. Agent Design
- **Graceful degradation**: Implement fallback mechanisms when vector search fails
- **Result interpretation**: Always validate and interpret search results contextually
- **User feedback**: Implement feedback loops to improve search quality

### 5. Security Considerations
- **Access control**: Implement proper authentication and authorization
- **Data privacy**: Ensure sensitive data is properly handled in embeddings
- **Query sanitization**: Sanitize user inputs to prevent injection attacks

## Troubleshooting

### Common Issues

1. **Low relevance scores**: Check embedding model consistency and query formulation
2. **Slow performance**: Review index configuration and query optimization
3. **Memory issues**: Monitor embedding cache size and implement proper cleanup
4. **Connection timeouts**: Implement connection pooling and retry logic

### Debugging Tools

```python
def debug_vector_search(query: str, expected_results: List[str]):
    """
    Debug helper for vector search issues
    """
    # Check embedding generation
    embedding = generate_embedding(query)
    print(f"Query embedding dimensions: {len(embedding)}")
    
    # Check index status
    index_stats = get_index_statistics()
    print(f"Index statistics: {index_stats}")
    
    # Perform search with detailed logging
    results = vector_search_with_logging(query, top_k=10)
    
    # Analyze result relevance
    for i, result in enumerate(results):
        print(f"Result {i+1}: Score={result['score']:.3f}, Content={result['content'][:100]}...")
        
        # Check if expected results appear
        for expected in expected_results:
            if expected.lower() in result['content'].lower():
                print(f"  ✓ Found expected result: {expected}")
```

## Next Steps

1. **Implement basic vector search tool** following Pattern 1
2. **Add contextual enhancement** using Pattern 2
3. **Optimize for your specific use case** with advanced patterns
4. **Add monitoring and observability** for production deployment
5. **Scale and optimize** based on performance metrics

## Additional Resources

- [DATABASE_NAME Vector Search Documentation](#)
- [Embedding Model Best Practices](#)
- [Agent Framework Integration Guides](#)
- [Performance Optimization Techniques](#)
- [Production Deployment Checklist](#)

---

*This template provides a comprehensive foundation for integrating vector search into agentic workflows. Adapt the examples to your specific database, embedding models, and agent framework.*