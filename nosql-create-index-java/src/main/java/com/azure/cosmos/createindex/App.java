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

        var credential = new DefaultAzureCredentialBuilder().build();
        try (var cosmosClient = DataPlane.createCosmosClient(credential, config)) {
            var openAiClient = DataPlane.createAzureOpenAIClient(credential, config);
            var database = cosmosClient.getDatabase(config.databaseName());

            // --- Setup ---
            System.out.println("Using Azure OpenAI Embedding Deployment/Model: " + config.openAiEmbeddingDeployment());
            System.out.println("Reading JSON file from " + config.dataFileWithVectors());

            DataPlane.verifyEmbeddingDimensions(openAiClient, config);
            List<Map<String, Object>> documents = DataPlane.readDocuments(config);
            System.out.println("Loaded " + documents.size() + " documents");

            // --- Ingest ---
            System.out.println("Processing in batches of " + documents.size() + "...");
            for (String containerName : Config.targetContainers(config)) {
                var container = database.getContainer(containerName);
                var summary = DataPlane.ingestDocuments(container, containerName, documents);
                System.out.printf("  \u2713 %s: %d upserted (%.2f RUs)%n", containerName, summary.upsertedDocuments(), summary.requestCharge());
            }

            // --- Query ---
            List<Float> queryEmbedding = DataPlane.generateEmbedding(openAiClient, config, config.queryText());
            System.out.println("\nQuery: \"" + config.queryText() + "\"");
            System.out.println("Embedding generated (" + queryEmbedding.size() + " dimensions)");
            System.out.println("\nRunning searches (top 5 results)...");

            List<Object[]> allResults = new java.util.ArrayList<>();
            for (String containerName : Config.targetContainers(config)) {
                var container = database.getContainer(containerName);
                QuerySummary summary = DataPlane.queryTopMatches(container, containerName, config, queryEmbedding);
                String label = Config.algorithmLabel(containerName);
                System.out.printf("  \u2713 %s queried (%.2f RUs)%n", containerName, summary.requestCharge());
                allResults.add(new Object[]{label, summary});
            }

            // --- Comparison table ---
            System.out.println();
            System.out.printf("| %-14s | %-26s | %-6s | %-26s | %-6s | %-6s |%n", "Algorithm", "Top 1 Result", "Score", "Top 2 Result", "Score", "Diff");
            System.out.printf("|%s|%s|%s|%s|%s|%s|%n", "-".repeat(16), "-".repeat(28), "-".repeat(8), "-".repeat(28), "-".repeat(8), "-".repeat(8));
            for (Object[] entry : allResults) {
                String label = (String) entry[0];
                QuerySummary summary = (QuerySummary) entry[1];
                String top1Name = summary.results().size() > 0 ? truncate(summary.results().get(0).hotelName(), 26) : "";
                double top1Score = summary.results().size() > 0 ? summary.results().get(0).score() : 0.0;
                String top2Name = summary.results().size() > 1 ? truncate(summary.results().get(1).hotelName(), 26) : "";
                double top2Score = summary.results().size() > 1 ? summary.results().get(1).score() : 0.0;
                double diff = top1Score - top2Score;
                System.out.printf("| %-14s | %-26s | %.4f | %-26s | %.4f | %.4f |%n", label, top1Name, top1Score, top2Name, top2Score, diff);
            }

            System.out.println("\nComplete");
        }
    }

    private static String truncate(String value, int maxLen) {
        if (value.length() <= maxLen) return value;
        return value.substring(0, maxLen - 3) + "...";
    }
}
