const { CosmosClient } = require("@azure/cosmos");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
require("dotenv").config();

const config = {
  cosmos: { endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY, databaseId: process.env.COSMOS_DATABASE_NAME || "vectordb", containerId: process.env.COSMOS_CONTAINER_NAME || "embeddings" },
  openai: { endpoint: process.env.AZURE_OPENAI_ENDPOINT, key: process.env.AZURE_OPENAI_API_KEY, embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "text-embedding-ada-002" }
};

const cosmosClient = new CosmosClient({ endpoint: config.cosmos.endpoint, key: config.cosmos.key });
const openaiClient = new OpenAIClient(config.openai.endpoint, new AzureKeyCredential(config.openai.key));

async function generateQueryEmbedding(queryText) {
  const result = await openaiClient.getEmbeddings(config.openai.embeddingDeployment, [queryText]);
  return result.data[0].embedding;
}

async function semanticSearch(container, queryText, topK = 10) {
  console.log(\`\\n=== Semantic Search: "\${queryText}" ===\`);
  const queryEmbedding = await generateQueryEmbedding(queryText);
  const querySpec = {
    query: \`SELECT TOP @topK c.id, c.title, c.content, VectorDistance(c.embedding, @embedding) AS similarity FROM c ORDER BY VectorDistance(c.embedding, @embedding)\`,
    parameters: [{ name: "@topK", value: topK }, { name: "@embedding", value: queryEmbedding }]
  };
  const { resources } = await container.items.query(querySpec).fetchAll();
  console.log(\`Results: \${resources.length} documents\`);
  return { results: resources };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Azure Cosmos DB - Vector Store Semantic Search");
  console.log("=".repeat(80));
  const container = cosmosClient.database(config.cosmos.databaseId).container(config.cosmos.containerId);
  const { results } = await semanticSearch(container, "machine learning fundamentals", 5);
  results.forEach((doc, i) => {
    const stars = doc.similarity < 0.1 ? "⭐⭐⭐" : doc.similarity < 0.3 ? "⭐⭐" : "⭐";
    console.log(\`\${i + 1}. \${doc.title} - Score: \${doc.similarity.toFixed(4)} \${stars}\`);
  });
  console.log("\\n✓ Semantic search complete");
}

if (require.main === module) { main().catch(console.error); }
module.exports = { semanticSearch, generateQueryEmbedding };
