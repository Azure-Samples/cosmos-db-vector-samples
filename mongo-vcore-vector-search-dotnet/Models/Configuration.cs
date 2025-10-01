namespace CosmosDbVectorSamples.Models;

public class AppConfiguration
{
    public AzureOpenAIConfiguration AzureOpenAI { get; set; } = new();
    public DataFilesConfiguration DataFiles { get; set; } = new();
    public EmbeddingConfiguration Embedding { get; set; } = new();
    public MongoDBConfiguration MongoDB { get; set; } = new();
    public VectorSearchConfiguration VectorSearch { get; set; } = new();
}

public class AzureOpenAIConfiguration
{
    public string EmbeddingModel { get; set; } = string.Empty;
    public string ApiVersion { get; set; } = string.Empty;
    public string Endpoint { get; set; } = string.Empty;
    // Note: API Key removed - using Microsoft Entra ID authentication via DefaultAzureCredential
}

public class DataFilesConfiguration
{
    public string WithoutVectors { get; set; } = string.Empty;
    public string WithVectors { get; set; } = string.Empty;
}

public class EmbeddingConfiguration
{
    public string FieldToEmbed { get; set; } = string.Empty;
    public string EmbeddedField { get; set; } = string.Empty;
    public int Dimensions { get; set; }
    public int BatchSize { get; set; }
}

public class MongoDBConfiguration
{
    public string ConnectionString { get; set; } = string.Empty;
    public string ClusterName { get; set; } = string.Empty;
    public int LoadBatchSize { get; set; }
    public string TenantId { get; set; } = string.Empty;
}

public class VectorSearchConfiguration
{
    public string Query { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public int TopK { get; set; }
}