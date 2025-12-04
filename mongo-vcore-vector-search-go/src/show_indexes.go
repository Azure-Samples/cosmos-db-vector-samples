package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// IndexInfo represents the structure of MongoDB index information
type IndexInfo struct {
	Name                      string                 `bson:"name"`
	Key                       bson.M                 `bson:"key"`
	Unique                    bool                   `bson:"unique,omitempty"`
	Sparse                    bool                   `bson:"sparse,omitempty"`
	Background                bool                   `bson:"background,omitempty"`
	VectorSearchConfiguration map[string]interface{} `bson:"vectorSearchConfiguration,omitempty"`
	CosmosSearchOptions       map[string]interface{} `bson:"cosmosSearchOptions,omitempty"`
}

// formatIndexInfo formats index information into a readable string representation
func formatIndexInfo(indexInfo IndexInfo) string {
	var lines []string

	// Basic index information
	name := indexInfo.Name
	if name == "" {
		name = "Unknown"
	}
	lines = append(lines, fmt.Sprintf("Index Name: %s", name))

	// Check if this is a vector index by looking for DocumentDB vector search configuration
	if indexInfo.CosmosSearchOptions != nil && len(indexInfo.CosmosSearchOptions) > 0 {
		lines = append(lines, "Type: DocumentDB Vector Search Index")

		// Vector search specific details
		if similarity, ok := indexInfo.CosmosSearchOptions["similarity"]; ok {
			lines = append(lines, fmt.Sprintf("Similarity Metric: %v", similarity))
		}
		if dimensions, ok := indexInfo.CosmosSearchOptions["dimensions"]; ok {
			lines = append(lines, fmt.Sprintf("Vector Dimensions: %v", dimensions))
		}

		// Check for specific vector index types and their parameters
		if kind, ok := indexInfo.CosmosSearchOptions["kind"]; ok {
			kindStr := fmt.Sprintf("%v", kind)
			switch {
			case strings.Contains(kindStr, "diskann"):
				lines = append(lines, "Algorithm: DiskANN")
				if maxDegree, ok := indexInfo.CosmosSearchOptions["maxDegree"]; ok {
					lines = append(lines, fmt.Sprintf("  Max Degree: %v", maxDegree))
				}
				if lBuild, ok := indexInfo.CosmosSearchOptions["lBuild"]; ok {
					lines = append(lines, fmt.Sprintf("  Build Parameter: %v", lBuild))
				}

			case strings.Contains(kindStr, "hnsw"):
				lines = append(lines, "Algorithm: HNSW (Hierarchical Navigable Small World)")
				if m, ok := indexInfo.CosmosSearchOptions["m"]; ok {
					lines = append(lines, fmt.Sprintf("  Max Connections: %v", m))
				}
				if efConstruction, ok := indexInfo.CosmosSearchOptions["efConstruction"]; ok {
					lines = append(lines, fmt.Sprintf("  EF Construction: %v", efConstruction))
				}

			case strings.Contains(kindStr, "ivf"):
				lines = append(lines, "Algorithm: IVF (Inverted File)")
				if numLists, ok := indexInfo.CosmosSearchOptions["numLists"]; ok {
					lines = append(lines, fmt.Sprintf("  Number of Lists: %v", numLists))
				}

			default:
				lines = append(lines, fmt.Sprintf("Algorithm: %s", kindStr))
			}
		}
	} else if indexInfo.VectorSearchConfiguration != nil && len(indexInfo.VectorSearchConfiguration) > 0 {
		// Handle standard MongoDB vector search configuration
		lines = append(lines, "Type: MongoDB Vector Search Index")

		if similarity, ok := indexInfo.VectorSearchConfiguration["similarity"]; ok {
			lines = append(lines, fmt.Sprintf("Similarity Metric: %v", similarity))
		}
		if dimensions, ok := indexInfo.VectorSearchConfiguration["dimensions"]; ok {
			lines = append(lines, fmt.Sprintf("Vector Dimensions: %v", dimensions))
		}
	} else {
		// Regular MongoDB index
		lines = append(lines, "Type: Standard MongoDB Index")

		// Show the key pattern for regular indexes
		if indexInfo.Key != nil && len(indexInfo.Key) > 0 {
			var keyFields []string
			for k, v := range indexInfo.Key {
				keyFields = append(keyFields, fmt.Sprintf("%s: %v", k, v))
			}
			lines = append(lines, fmt.Sprintf("Key Pattern: %s", strings.Join(keyFields, ", ")))
		}
	}

	// Index status and statistics if available
	if indexInfo.Unique {
		lines = append(lines, "Unique: Yes")
	}

	if indexInfo.Sparse {
		lines = append(lines, "Sparse: Yes")
	}

	if indexInfo.Background {
		lines = append(lines, "Built in Background: Yes")
	}

	// Add indentation to each line
	var indentedLines []string
	for _, line := range lines {
		indentedLines = append(indentedLines, fmt.Sprintf("  %s", line))
	}

	return strings.Join(indentedLines, "\n")
}

// showCollectionIndexes displays all indexes for a specific collection
func showCollectionIndexes(ctx context.Context, collection *mongo.Collection, collectionName string) error {
	fmt.Printf("\n%s\n", strings.Repeat("=", 80))
	fmt.Printf("INDEXES FOR COLLECTION: %s\n", collectionName)
	fmt.Printf("%s\n", strings.Repeat("=", 80))

	// Get all indexes for this collection
	// NOTE: This operation can be slow on large collections with many indexes
	cursor, err := collection.Indexes().List(ctx)
	if err != nil {
		return fmt.Errorf("error retrieving indexes for collection '%s': %v (check permissions and connectivity)", collectionName, err)
	}
	defer cursor.Close(ctx)

	var indexes []IndexInfo
	if err := cursor.All(ctx, &indexes); err != nil {
		return fmt.Errorf("error decoding indexes: %v", err)
	}

	if len(indexes) == 0 {
		fmt.Println("No indexes found in this collection.")
		return nil
	}

	fmt.Printf("Found %d index(es):\n\n", len(indexes))

	// Display each index with its details
	for i, indexInfo := range indexes {
		fmt.Printf("Index %d:\n", i+1)
		fmt.Println(formatIndexInfo(indexInfo))

		// Add separator between indexes (except for the last one)
		if i < len(indexes)-1 {
			fmt.Printf("\n%s\n", strings.Repeat("-", 60))
		}
		fmt.Println()
	}

	return nil
}

// showDatabaseCollectionsAndIndexes displays all collections in a database and their indexes
func showDatabaseCollectionsAndIndexes(ctx context.Context, database *mongo.Database, databaseName string) error {
	fmt.Printf("\n%s\n", strings.Repeat("#", 80))
	fmt.Printf("DATABASE: %s\n", databaseName)
	fmt.Printf("%s\n", strings.Repeat("#", 80))

	// Get list of all collections in the database
	collectionNames, err := database.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return fmt.Errorf("error accessing database '%s': %v", databaseName, err)
	}

	if len(collectionNames) == 0 {
		fmt.Println("No collections found in this database.")
		return nil
	}

	fmt.Printf("Found %d collection(s) in database:\n", len(collectionNames))

	// Show indexes for each collection
	for _, collectionName := range collectionNames {
		collection := database.Collection(collectionName)

		// Get basic collection statistics
		var docCount int64
		var err error
		docCount, err = collection.CountDocuments(ctx, bson.M{})
		if err != nil {
			// If count fails, just show the collection name
			fmt.Printf("\nCollection: %s\n", collectionName)
		} else {
			fmt.Printf("\nCollection: %s (%d documents)\n", collectionName, docCount)
		}

		// Show all indexes for this collection
		if err := showCollectionIndexes(ctx, collection, collectionName); err != nil {
			fmt.Printf("Error showing indexes for collection '%s': %v\n", collectionName, err)
		}
	}

	return nil
}

// main function displays vector indexes and collection information
func main() {
	ctx := context.Background()

	fmt.Println("Vector Index Information Display")
	fmt.Printf("%s\n", strings.Repeat("=", 50))

	// Load configuration from environment variables
	config := LoadConfig()

	fmt.Printf("Default Database: %s\n", config.DatabaseName)
	fmt.Printf("Default Collection: %s\n", config.CollectionName)

	// Initialize MongoDB client
	fmt.Println("\nConnecting to MongoDB...")
	mongoClient, _, err := GetClientsPasswordless()
	if err != nil {
		log.Fatalf("Failed to initialize MongoDB client: %v", err)
	}
	defer mongoClient.Disconnect(ctx)

	// Option 1: Show indexes for the default database and collection
	fmt.Printf("\n%s\n", strings.Repeat("*", 80))
	fmt.Println("OPTION 1: DEFAULT DATABASE AND COLLECTION")
	fmt.Printf("%s\n", strings.Repeat("*", 80))

	database := mongoClient.Database(config.DatabaseName)
	collection := database.Collection(config.CollectionName)

	// Check if the collection exists and has documents
	docCount, err := collection.CountDocuments(ctx, bson.M{})
	if err != nil {
		fmt.Printf("Cannot access collection '%s': %v\n", config.CollectionName, err)
	} else if docCount > 0 {
		fmt.Printf("Collection '%s' contains %d documents\n", config.CollectionName, docCount)
		if err := showCollectionIndexes(ctx, collection, config.CollectionName); err != nil {
			fmt.Printf("Error: %v\n", err)
		}
	} else {
		fmt.Printf("Collection '%s' is empty or doesn't exist.\n", config.CollectionName)
		fmt.Println("Run one of the vector search scripts (diskann.go, hnsw.go, ivf.go) first.")
	}

	// Option 2: Show all databases and their collections
	fmt.Printf("\n%s\n", strings.Repeat("*", 80))
	fmt.Println("OPTION 2: ALL DATABASES AND COLLECTIONS")
	fmt.Printf("%s\n", strings.Repeat("*", 80))

	// Get list of all databases
	databaseNames, err := mongoClient.ListDatabaseNames(ctx, bson.M{})
	if err != nil {
		fmt.Printf("Error listing databases: %v\n", err)
	} else {
		// Filter out system databases that users typically don't care about
		var userDatabases []string
		systemDatabases := map[string]bool{
			"admin":  true,
			"local":  true,
			"config": true,
		}

		for _, dbName := range databaseNames {
			if !systemDatabases[dbName] {
				userDatabases = append(userDatabases, dbName)
			}
		}

		if len(userDatabases) > 0 {
			fmt.Printf("Found %d user database(s):\n", len(userDatabases))

			for _, dbName := range userDatabases {
				database := mongoClient.Database(dbName)
				if err := showDatabaseCollectionsAndIndexes(ctx, database, dbName); err != nil {
					fmt.Printf("Error processing database '%s': %v\n", dbName, err)
				}
			}
		} else {
			fmt.Println("No user databases found.")
		}
	}

	fmt.Printf("\n%s\n", strings.Repeat("=", 80))
	fmt.Println("Index information display completed.")
	fmt.Println("Use this information to:")
	fmt.Println("  • Verify vector indexes are created correctly")
	fmt.Println("  • Check index configuration parameters")
	fmt.Println("  • Monitor index status and performance")
	fmt.Println("  • Debug vector search issues")
	fmt.Printf("%s\n", strings.Repeat("=", 80))
}
