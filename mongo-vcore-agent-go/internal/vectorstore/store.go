package vectorstore

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Azure-Samples/cosmos-db-vector-samples/mongo-vcore-agent-go/internal/models"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// VectorStoreConfig holds MongoDB configuration
type VectorStoreConfig struct {
	ConnectionString string
	ClusterName      string // For passwordless authentication
	DatabaseName     string
	CollectionName   string
	IndexName        string
	UsePasswordless  bool
	Debug            bool
}

// VectorStore manages MongoDB operations for vector search
type VectorStore struct {
	Config     *VectorStoreConfig
	Client     *mongo.Client
	Database   *mongo.Database
	Collection *mongo.Collection
}

// LoadConfigFromEnv loads vector store configuration from environment
func LoadConfigFromEnv() *VectorStoreConfig {
	debug := os.Getenv("DEBUG") == "true" || os.Getenv("DEBUG") == "1"
	usePasswordless := os.Getenv("USE_PASSWORDLESS") == "true" || os.Getenv("USE_PASSWORDLESS") == "1"

	return &VectorStoreConfig{
		ConnectionString: os.Getenv("AZURE_DOCUMENTDB_CONNECTION_STRING"),
		ClusterName:      os.Getenv("MONGO_CLUSTER_NAME"),
		DatabaseName:     os.Getenv("MONGO_DB_NAME"),
		CollectionName:   os.Getenv("MONGO_DB_COLLECTION"),
		IndexName:        os.Getenv("MONGO_DB_INDEX_NAME"),
		UsePasswordless:  usePasswordless,
		Debug:            debug,
	}
}

// NewVectorStore creates a new vector store connection with passwordless authentication support
func NewVectorStore(ctx context.Context, config *VectorStoreConfig) (*VectorStore, error) {
	var client *mongo.Client
	var err error

	// Determine authentication method based on USE_PASSWORDLESS flag or auto-detection
	usePasswordless := config.UsePasswordless || (config.ConnectionString == "" && config.ClusterName != "")

	if usePasswordless {
		// Use passwordless authentication with Azure Identity
		if config.Debug {
			fmt.Println("[vectorstore] Using passwordless (OIDC) authentication")
		}
		if config.ClusterName == "" {
			return nil, fmt.Errorf("MONGO_CLUSTER_NAME is required for passwordless authentication")
		}
		client, err = connectWithOIDC(ctx, config.ClusterName, config.Debug)
		if err != nil {
			return nil, fmt.Errorf("OIDC authentication failed: %w", err)
		}
	} else {
		// Use connection string authentication
		if config.Debug {
			fmt.Println("[vectorstore] Using connection string authentication")
		}
		if config.ConnectionString == "" {
			return nil, fmt.Errorf("AZURE_DOCUMENTDB_CONNECTION_STRING is required when USE_PASSWORDLESS is not enabled")
		}
		clientOptions := options.Client().ApplyURI(config.ConnectionString)
		client, err = mongo.Connect(ctx, clientOptions)
		if err != nil {
			return nil, fmt.Errorf("failed to connect to MongoDB: %w", err)
		}
	}

	// Ping to verify connection
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	database := client.Database(config.DatabaseName)
	collection := database.Collection(config.CollectionName)

	if config.Debug {
		fmt.Printf("[vectorstore] Connected to database: %s, collection: %s\n", config.DatabaseName, config.CollectionName)
	}

	return &VectorStore{
		Config:     config,
		Client:     client,
		Database:   database,
		Collection: collection,
	}, nil
}

// connectWithOIDC creates a MongoDB client using OIDC authentication
func connectWithOIDC(ctx context.Context, clusterName string, debug bool) (*mongo.Client, error) {
	// Create Azure credential
	credential, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Azure credential: %w", err)
	}

	// Construct MongoDB URI for Azure DocumentDB
	mongoURI := fmt.Sprintf("mongodb+srv://%s.global.mongocluster.cosmos.azure.com/", clusterName)

	if debug {
		fmt.Printf("[vectorstore] Attempting OIDC authentication to %s\n", clusterName)
	}

	// Create OIDC machine callback using Azure credential
	oidcCallback := func(ctx context.Context, args *options.OIDCArgs) (*options.OIDCCredential, error) {
		scope := "https://ossrdbms-aad.database.windows.net/.default"
		if debug {
			fmt.Printf("[vectorstore] Getting token with scope: %s\n", scope)
		}
		token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
			Scopes: []string{scope},
		})
		if err != nil {
			return nil, fmt.Errorf("failed to get token with scope %s: %w", scope, err)
		}

		if debug {
			fmt.Println("[vectorstore] Successfully obtained token")
		}

		return &options.OIDCCredential{
			AccessToken: token.Token,
		}, nil
	}

	// Set up MongoDB client options with OIDC authentication
	clientOptions := options.Client().
		ApplyURI(mongoURI).
		SetConnectTimeout(30 * time.Second).
		SetServerSelectionTimeout(30 * time.Second).
		SetRetryWrites(true).
		SetAuth(options.Credential{
			AuthMechanism: "MONGODB-OIDC",
			// For local development, don't set ENVIRONMENT=azure to allow custom callbacks
			AuthMechanismProperties: map[string]string{
				"TOKEN_RESOURCE": "https://ossrdbms-aad.database.windows.net",
			},
			OIDCMachineCallback: oidcCallback,
		})

	mongoClient, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, fmt.Errorf("failed to connect with OIDC: %w", err)
	}

	if debug {
		fmt.Println("[vectorstore] OIDC authentication successful!")
	}

	return mongoClient, nil
}

// Close closes the MongoDB connection
func (vs *VectorStore) Close(ctx context.Context) error {
	return vs.Client.Disconnect(ctx)
}

// LoadHotelsFromJSON loads hotels from a JSON file
func LoadHotelsFromJSON(filePath string) ([]models.Hotel, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var hotels []models.Hotel
	if err := json.Unmarshal(data, &hotels); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	return hotels, nil
}

// InsertHotelsWithEmbeddings inserts hotels with their embeddings
func (vs *VectorStore) InsertHotelsWithEmbeddings(ctx context.Context, hotels []models.HotelForVectorStore) error {
	if len(hotels) == 0 {
		return nil
	}

	// Convert to bson documents
	docs := make([]interface{}, len(hotels))
	for i, hotel := range hotels {
		docs[i] = hotel
	}

	result, err := vs.Collection.InsertMany(ctx, docs)
	if err != nil {
		return fmt.Errorf("failed to insert documents: %w", err)
	}

	if vs.Config.Debug {
		fmt.Printf("[vectorstore] Inserted %d documents\n", len(result.InsertedIDs))
	}

	return nil
}

// CreateVectorIndex creates a vector search index
func (vs *VectorStore) CreateVectorIndex(ctx context.Context) error {
	algorithm := os.Getenv("VECTOR_INDEX_ALGORITHM")
	if algorithm == "" {
		algorithm = "vector-ivf"
	}

	dimensions := 1536
	if dimStr := os.Getenv("EMBEDDING_DIMENSIONS"); dimStr != "" {
		if d, err := strconv.Atoi(dimStr); err == nil {
			dimensions = d
		}
	}

	similarity := os.Getenv("VECTOR_SIMILARITY")
	if similarity == "" {
		similarity = "COS"
	}

	// Build cosmosSearchOptions based on algorithm
	var cosmosSearchOptions bson.D

	switch algorithm {
	case "vector-ivf":
		numLists := 10
		if nlStr := os.Getenv("IVF_NUM_LISTS"); nlStr != "" {
			if nl, err := strconv.Atoi(nlStr); err == nil {
				numLists = nl
			}
		}
		cosmosSearchOptions = bson.D{
			{Key: "kind", Value: "vector-ivf"},
			{Key: "numLists", Value: numLists},
			{Key: "dimensions", Value: dimensions},
			{Key: "similarity", Value: similarity},
		}

	case "vector-hnsw":
		m := 16
		efConstruction := 64
		if mStr := os.Getenv("HNSW_M"); mStr != "" {
			if mVal, err := strconv.Atoi(mStr); err == nil {
				m = mVal
			}
		}
		if efStr := os.Getenv("HNSW_EF_CONSTRUCTION"); efStr != "" {
			if efVal, err := strconv.Atoi(efStr); err == nil {
				efConstruction = efVal
			}
		}
		cosmosSearchOptions = bson.D{
			{Key: "kind", Value: "vector-hnsw"},
			{Key: "m", Value: m},
			{Key: "efConstruction", Value: efConstruction},
			{Key: "dimensions", Value: dimensions},
			{Key: "similarity", Value: similarity},
		}

	case "vector-diskann":
		maxDegree := 20
		lBuild := 10
		if mdStr := os.Getenv("DISKANN_MAX_DEGREE"); mdStr != "" {
			if md, err := strconv.Atoi(mdStr); err == nil {
				maxDegree = md
			}
		}
		if lbStr := os.Getenv("DISKANN_L_BUILD"); lbStr != "" {
			if lb, err := strconv.Atoi(lbStr); err == nil {
				lBuild = lb
			}
		}
		cosmosSearchOptions = bson.D{
			{Key: "kind", Value: "vector-diskann"},
			{Key: "maxDegree", Value: maxDegree},
			{Key: "lBuild", Value: lBuild},
			{Key: "dimensions", Value: dimensions},
			{Key: "similarity", Value: similarity},
		}

	default:
		return fmt.Errorf("unsupported vector index algorithm: %s", algorithm)
	}

	// DocumentDB uses "cosmosSearch" as the index type
	indexDef := bson.D{
		{Key: "createIndexes", Value: vs.Config.CollectionName},
		{Key: "indexes", Value: bson.A{
			bson.D{
				{Key: "name", Value: vs.Config.IndexName},
				{Key: "key", Value: bson.D{{Key: "contentVector", Value: "cosmosSearch"}}},
				{Key: "cosmosSearchOptions", Value: cosmosSearchOptions},
			},
		}},
	}

	if err := vs.Database.RunCommand(ctx, indexDef).Err(); err != nil {
		return fmt.Errorf("failed to create vector index: %w", err)
	}

	if vs.Config.Debug {
		fmt.Printf("[vectorstore] Created vector index: %s (algorithm: %s)\n", vs.Config.IndexName, algorithm)
	}

	return nil
}

// VectorSearch performs a vector similarity search
func (vs *VectorStore) VectorSearch(ctx context.Context, queryVector []float32, k int) ([]models.HotelSearchResult, error) {
	// Convert float32 to interface{} for BSON
	vectorInterface := make([]interface{}, len(queryVector))
	for i, v := range queryVector {
		vectorInterface[i] = v
	}

	pipeline := mongo.Pipeline{
		{{Key: "$search", Value: bson.D{
			{Key: "cosmosSearch", Value: bson.D{
				{Key: "vector", Value: vectorInterface},
				{Key: "path", Value: "contentVector"},
				{Key: "k", Value: k},
			}},
		}}},
		{{Key: "$project", Value: bson.D{
			{Key: "score", Value: bson.D{{Key: "$meta", Value: "searchScore"}}},
			{Key: "document", Value: "$$ROOT"},
		}}},
	}

	cursor, err := vs.Collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("vector search failed: %w", err)
	}
	defer cursor.Close(ctx)

	var results []models.HotelSearchResult
	for cursor.Next(ctx) {
		var result struct {
			Score    float64                    `bson:"score"`
			Document models.HotelForVectorStore `bson:"document"`
		}
		if err := cursor.Decode(&result); err != nil {
			return nil, fmt.Errorf("failed to decode result: %w", err)
		}

		results = append(results, models.HotelSearchResult{
			Hotel: result.Document,
			Score: result.Score,
		})
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor error: %w", err)
	}

	if vs.Config.Debug {
		fmt.Printf("[vectorstore] Found %d results from vector search\n", len(results))
	}

	return results, nil
}

// FormatHotelForSynthesizer formats a hotel result for the synthesizer agent
func FormatHotelForSynthesizer(result models.HotelSearchResult) string {
	hotel := result.Hotel
	tags := strings.Join(hotel.Tags, ", ")

	fields := []string{
		"--- HOTEL START ---",
		fmt.Sprintf("HotelId: %s", hotel.HotelID),
		fmt.Sprintf("HotelName: %s", hotel.HotelName),
		fmt.Sprintf("Description: %s", hotel.Description),
		fmt.Sprintf("Category: %s", hotel.Category),
		fmt.Sprintf("Tags: %s", tags),
		fmt.Sprintf("ParkingIncluded: %t", hotel.ParkingIncluded),
		fmt.Sprintf("IsDeleted: %t", hotel.IsDeleted),
		fmt.Sprintf("LastRenovationDate: %s", hotel.LastRenovationDate.Format("2006-01-02")),
		fmt.Sprintf("Rating: %.1f", hotel.Rating),
		fmt.Sprintf("Address.StreetAddress: %s", hotel.Address.StreetAddress),
		fmt.Sprintf("Address.City: %s", hotel.Address.City),
		fmt.Sprintf("Address.StateProvince: %s", hotel.Address.StateProvince),
		fmt.Sprintf("Address.PostalCode: %s", hotel.Address.PostalCode),
		fmt.Sprintf("Address.Country: %s", hotel.Address.Country),
		fmt.Sprintf("Score: %.6f", result.Score),
		"--- HOTEL END ---",
	}

	return strings.Join(fields, "\n")
}

// DeleteDatabase drops the entire database
func (vs *VectorStore) DeleteDatabase(ctx context.Context) error {
	if err := vs.Database.Drop(ctx); err != nil {
		return fmt.Errorf("failed to drop database: %w", err)
	}

	if vs.Config.Debug {
		fmt.Printf("[vectorstore] Deleted database: %s\n", vs.Config.DatabaseName)
	}

	return nil
}
