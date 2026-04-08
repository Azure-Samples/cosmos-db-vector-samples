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

async function vectorSearch(container, queryText, topK = 20) {
  const queryEmbedding = await generateQueryEmbedding(queryText);
  const querySpec = {
    query: \`SELECT TOP @topK c.id, c.title, VectorDistance(c.embedding, @embedding) AS score FROM c ORDER BY VectorDistance(c.embedding, @embedding)\`,
    parameters: [{ name: "@topK", value: topK }, { name: "@embedding", value: queryEmbedding }]
  };
  const { resources } = await container.items.query(querySpec).fetchAll();
  return resources;
}

async function keywordSearch(container, queryText, topK = 20) {
  const querySpec = {
    query: \`SELECT TOP @topK c.id, c.title, (FullTextScore(c.title, @searchTerm) + FullTextScore(c.content, @searchTerm)) AS score FROM c WHERE FullTextContains(c.title, @searchTerm) OR FullTextContains(c.content, @searchTerm) ORDER BY score DESC\`,
    parameters: [{ name: "@topK", value: topK }, { name: "@searchTerm", value: queryText }]
  };
  const { resources } = await container.items.query(querySpec).fetchAll();
  return resources;
}

function applyRRF(vectorResults, keywordResults, weights = { vector: 1.0, keyword: 1.0 }, k = 60) {
  const scores = new Map();
  vectorResults.forEach((doc, index) => {
    const rank = index + 1;
    scores.set(doc.id, { ...doc, vectorRank: rank, keywordRank: null, rrfScore: weights.vector / (rank + k) });
  });
  keywordResults.forEach((doc, index) => {
    const rank = index + 1;
    const rrfScore = weights.keyword / (rank + k);
    if (scores.has(doc.id)) {
      scores.get(doc.id).keywordRank = rank;
      scores.get(doc.id).rrfScore += rrfScore;
    } else {
      scores.set(doc.id, { ...doc, vectorRank: null, keywordRank: rank, rrfScore });
    }
  });
  return Array.from(scores.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

async function hybridSearch(container, queryText, topK = 10, weights = { vector: 1.0, keyword: 1.0 }) {
  console.log(\`\\n=== Hybrid Search: "\${queryText}" ===\`);
  const vectorResults = await vectorSearch(container, queryText, topK * 2);
  const keywordResults = await keywordSearch(container, queryText, topK * 2);
  return applyRRF(vectorResults, keywordResults, weights).slice(0, topK);
}

async function main() {
  console.log("=".repeat(80));
  console.log("Azure Cosmos DB - Hybrid Search with RRF");
  console.log("=".repeat(80));
  const container = cosmosClient.database(config.cosmos.databaseId).container(config.cosmos.containerId);
  const results = await hybridSearch(container, "machine learning deployment", 5);
  results.forEach((doc, i) => {
    console.log(\`\${i + 1}. \${doc.title}\`);
    console.log(\`   RRF Score: \${doc.rrfScore.toFixed(4)}\`);
    console.log(\`   Vector Rank: \${doc.vectorRank || "N/A"}, Keyword Rank: \${doc.keywordRank || "N/A"}\`);
  });
  console.log("\\n✓ Hybrid search complete");
}

if (require.main === module) { main().catch(console.error); }
module.exports = { hybridSearch, vectorSearch, keywordSearch, applyRRF };
