package com.azure.documentdb.samples;

import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.models.EmbeddingsOptions;
import com.azure.identity.DefaultAzureCredentialBuilder;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.AggregateIterable;
import com.mongodb.client.model.Indexes;
import com.mongodb.MongoClientSettings;
import com.mongodb.MongoCredential;
import com.mongodb.ConnectionString;
import org.bson.Document;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Vector search application using IVF index.
 */
public class IVF {
    private static final String SAMPLE_QUERY = "What are some hotels with good accessibility?";
    private static final String DATABASE_NAME = "travel";
    private static final String COLLECTION_NAME = "hotels_ivf";
    private static final String VECTOR_INDEX_NAME = "vectorIndex_ivf";
    
    private final AppConfig config = new AppConfig();
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    public static void main(String[] args) {
        new IVF().run();
        System.exit(0);
    }
    
    public void run() {
        try (var mongoClient = createMongoClient()) {
            var openAIClient = createOpenAIClient();
            
            var database = mongoClient.getDatabase(DATABASE_NAME);
            var collection = database.getCollection(COLLECTION_NAME, Document.class);
            
            // Drop and recreate collection
            collection.drop();
            database.createCollection(COLLECTION_NAME);
            System.out.println("Created collection: " + COLLECTION_NAME);
            
            // Load and insert data
            var hotelData = loadHotelData();
            insertDataInBatches(collection, hotelData);
            
            // Create standard indexes
            collection.createIndex(Indexes.ascending("HotelName"));
            collection.createIndex(Indexes.ascending("Category"));
            
            // Create vector index
            createVectorIndex(database);
            
            // Perform vector search
            var queryEmbedding = createEmbedding(openAIClient, SAMPLE_QUERY);
            performVectorSearch(collection, queryEmbedding);
            
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
        }
    }
    
    private MongoClient createMongoClient() {
        var clusterName = config.get("MONGO_CLUSTER_NAME");
        var azureCredential = new DefaultAzureCredentialBuilder().build();
        
        MongoCredential.OidcCallback callback = (MongoCredential.OidcCallbackContext context) -> {
            var token = azureCredential.getToken(
                new com.azure.core.credential.TokenRequestContext()
                    .addScopes("https://ossrdbms-aad.database.windows.net/.default")
            ).block();
            
            if (token == null) {
                throw new RuntimeException("Failed to obtain Azure AD token");
            }
            
            return new MongoCredential.OidcCallbackResult(token.getToken());
        };
        
        var credential = MongoCredential.createOidcCredential(null)
            .withMechanismProperty("OIDC_CALLBACK", callback);
        
        var connectionString = new ConnectionString(
            String.format("mongodb+srv://%s.mongocluster.cosmos.azure.com/?authMechanism=MONGODB-OIDC&tls=true&retrywrites=false&maxIdleTimeMS=120000", clusterName)
        );
        
        var settings = MongoClientSettings.builder()
            .applyConnectionString(connectionString)
            .credential(credential)
            .build();
        
        return MongoClients.create(settings);
    }
    
    private OpenAIClient createOpenAIClient() {
        var endpoint = config.get("AZURE_OPENAI_EMBEDDING_ENDPOINT");
        var credential = new DefaultAzureCredentialBuilder().build();
        
        return new OpenAIClientBuilder()
            .endpoint(endpoint)
            .credential(credential)
            .buildClient();
    }
    
    private List<HotelData> loadHotelData() throws IOException {
        var dataFile = config.getOrDefault("DATA_FILE_WITH_VECTORS", "HotelsData_toCosmosDB_Vector.json");
        var filePath = Path.of(dataFile);
        
        System.out.println("Reading JSON file from " + filePath.toAbsolutePath());
        var jsonContent = Files.readString(filePath);
        
        return objectMapper.readValue(jsonContent, new TypeReference<List<HotelData>>() {});
    }
    
    private void insertDataInBatches(MongoCollection<Document> collection, List<HotelData> hotelData) {
        var batchSize = config.getIntOrDefault("LOAD_SIZE_BATCH", 100);
        var batches = partitionList(hotelData, batchSize);
        
        System.out.println("Processing in batches of " + batchSize + "...");
        
        for (int i = 0; i < batches.size(); i++) {
            var batch = batches.get(i);
            var documents = batch.stream()
                .map(this::convertToDocument)
                .toList();
            
            collection.insertMany(documents);
            System.out.println("Batch " + (i + 1) + " complete: " + documents.size() + " inserted");
        }
    }
    
    private Document convertToDocument(HotelData hotel) {
        try {
            var json = objectMapper.writeValueAsString(hotel);
            return Document.parse(json);
        } catch (Exception e) {
            throw new RuntimeException("Failed to convert hotel to document", e);
        }
    }
    
    private void createVectorIndex(MongoDatabase database) {
        var indexDefinition = new Document()
            .append("createIndexes", COLLECTION_NAME)
            .append("indexes", List.of(
                new Document()
                    .append("name", VECTOR_INDEX_NAME)
                    .append("key", new Document("text_embedding_ada_002", "cosmosSearch"))
                    .append("cosmosSearchOptions", new Document()
                        .append("kind", "vector-ivf")
                        .append("dimensions", config.getIntOrDefault("EMBEDDING_DIMENSIONS", 1536))
                        .append("similarity", "COS")
                        .append("numLists", 1)
                    )
            ));
        
        database.runCommand(indexDefinition);
        System.out.println("Created vector index: " + VECTOR_INDEX_NAME);
    }
    
    private List<Double> createEmbedding(OpenAIClient openAIClient, String text) {
        var model = config.getOrDefault("AZURE_OPENAI_EMBEDDING_MODEL", "text-embedding-ada-002");
        var options = new EmbeddingsOptions(List.of(text));
        
        var response = openAIClient.getEmbeddings(model, options);
        return response.getData().get(0).getEmbedding().stream()
                .map(Float::doubleValue)
                .toList();
    }
    
    private void performVectorSearch(MongoCollection<Document> collection, List<Double> queryEmbedding) {
        var searchStage = new Document("$search", new Document()
            .append("cosmosSearch", new Document()
                .append("vector", queryEmbedding)
                .append("path", "text_embedding_ada_002")
                .append("k", 5)
            )
        );
        
        var projectStage = new Document("$project", new Document()
            .append("HotelName", 1)
            .append("score", new Document("$meta", "searchScore"))
        );
        
        var pipeline = List.of(searchStage, projectStage);
        
        System.out.println("\nVector search results for: \"" + SAMPLE_QUERY + "\"");
        
        AggregateIterable<Document> results = collection.aggregate(pipeline);
        var rank = 1;
        
        for (var result : results) {
            var hotelName = result.getString("HotelName");
            var score = result.getDouble("score");
            System.out.printf("%d. HotelName: %s, Score: %.4f%n", rank++, hotelName, score);
        }
    }
    
    private static <T> List<List<T>> partitionList(List<T> list, int batchSize) {
        var partitions = new ArrayList<List<T>>();
        for (int i = 0; i < list.size(); i += batchSize) {
            partitions.add(list.subList(i, Math.min(i + batchSize, list.size())));
        }
        return partitions;
    }
}
