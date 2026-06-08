package com.azure.cosmos.createindex;

import com.azure.cosmos.CosmosException;
import com.azure.identity.DefaultAzureCredentialBuilder;

import java.util.List;
import java.util.Map;

public final class App {
    private App() {
    }

    public static void main(String[] args) {
        try {
            run();
        } catch (CosmosException exception) {
            System.err.println("\nError: Cosmos DB data-plane request failed. Verify that azd up created the database and containers and that your identity has the required Microsoft Entra ID roles. Original error: "
                    + exception.getMessage());
            System.exit(1);
        } catch (Exception exception) {
            System.err.println("\nError: " + exception.getMessage());
            System.exit(1);
        }
    }

    private static void run() throws Exception {
        SampleConfig config = Config.load();
        Config.validate(config);

        System.out.println("========================================================================");
        System.out.println("Azure Cosmos DB for NoSQL - create and query vector indexes with Java");
        System.out.println("========================================================================");
        System.out.println("Database: " + config.databaseName());
        System.out.println("Data file: " + config.dataFileWithVectors());
        System.out.println("Target containers: " + String.join(", ", Config.targetContainers(config)));

        var credential = new DefaultAzureCredentialBuilder().build();
        try (var cosmosClient = DataPlane.createCosmosClient(credential, config)) {
            var openAiClient = DataPlane.createAzureOpenAIClient(credential, config);
            var database = cosmosClient.getDatabase(config.databaseName());

            DataPlane.verifyEmbeddingDimensions(openAiClient, config);
            List<Map<String, Object>> documents = DataPlane.readDocuments(config);

            for (String containerName : Config.targetContainers(config)) {
                var container = database.getContainer(containerName);
                DataPlane.ingestDocuments(container, containerName, documents);
            }

            List<Float> queryEmbedding = DataPlane.generateEmbedding(openAiClient, config, config.queryText());
            System.out.println("\nQuery text: " + config.queryText());

            for (String containerName : Config.targetContainers(config)) {
                var container = database.getContainer(containerName);
                QuerySummary summary = DataPlane.queryTopMatches(container, containerName, config, queryEmbedding);
                DataPlane.printQuerySummary(summary);
            }
        }

        System.out.println("\n========================================================================");
        System.out.println("Complete");
        System.out.println("========================================================================");
    }
}
