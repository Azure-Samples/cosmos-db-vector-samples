package data

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos"
)

// Hotel represents a single hotel document from the JSON data file.
// Fields match the HotelsData_toCosmosDB_Vector.json schema.
type Hotel struct {
	HotelID           string                 `json:"HotelId"`
	HotelName         string                 `json:"HotelName"`
	Description       string                 `json:"Description"`
	DescriptionFr     string                 `json:"Description_fr"`
	Category          string                 `json:"Category"`
	Tags              []string               `json:"Tags"`
	ParkingIncluded   bool                   `json:"ParkingIncluded"`
	IsDeleted         bool                   `json:"IsDeleted"`
	LastRenovation    string                 `json:"LastRenovationDate"`
	Rating            float64                `json:"Rating"`
	Address           map[string]interface{} `json:"Address"`
	Location          map[string]interface{} `json:"Location"`
	Rooms             []interface{}          `json:"Rooms"`
	DescriptionVector []float32              `json:"DescriptionVector"`
}

// InsertStats tracks the outcome of a bulk-insert operation.
type InsertStats struct {
	Total         int
	Inserted      int
	Failed        int
	Skipped       int
	RequestCharge float64
}

// LoadHotelsJSON reads and unmarshals the hotels JSON data file.
func LoadHotelsJSON(filePath string) ([]Hotel, error) {
	fmt.Printf("Reading JSON file from %s\n", filePath)

	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("error reading file %q: %w", filePath, err)
	}

	var hotels []Hotel
	if err := json.Unmarshal(raw, &hotels); err != nil {
		return nil, fmt.Errorf("error parsing JSON in file %q: %w", filePath, err)
	}

	fmt.Printf("Loaded %d hotel documents\n", len(hotels))
	return hotels, nil
}

// InsertData inserts hotel documents into a Cosmos DB container one at a time.
// Duplicates are detected via 409 Conflict and counted as skipped.
func InsertData(ctx context.Context, container *azcosmos.ContainerClient, hotels []Hotel) (*InsertStats, error) {
	fmt.Printf("Inserting %d items (duplicates will be skipped)...\n", len(hotels))

	stats := &InsertStats{Total: len(hotels)}
	for i, h := range hotels {
		// Build the document with "id" set to HotelId (required by Cosmos DB).
		doc := map[string]interface{}{
			"id":                 h.HotelID,
			"HotelId":           h.HotelID,
			"HotelName":         h.HotelName,
			"Description":       h.Description,
			"Description_fr":    h.DescriptionFr,
			"Category":          h.Category,
			"Tags":              h.Tags,
			"ParkingIncluded":   h.ParkingIncluded,
			"IsDeleted":         h.IsDeleted,
			"LastRenovationDate": h.LastRenovation,
			"Rating":            h.Rating,
			"Address":           h.Address,
			"Location":          h.Location,
			"Rooms":             h.Rooms,
			"DescriptionVector": h.DescriptionVector,
		}

		body, err := json.Marshal(doc)
		if err != nil {
			stats.Failed++
			fmt.Printf("  [%d/%d] Marshal error for %s: %v\n", i+1, stats.Total, h.HotelID, err)
			continue
		}

		pk := azcosmos.NewPartitionKey().AppendString(h.HotelID)
		resp, err := container.CreateItem(ctx, pk, body, nil)
		if err != nil {
			var respErr *azcore.ResponseError
			if errors.As(err, &respErr) && respErr.StatusCode == http.StatusConflict {
				stats.Skipped++
				continue
			}
			stats.Failed++
			fmt.Printf("  [%d/%d] Insert failed for %s: %v\n", i+1, stats.Total, h.HotelID, err)
			continue
		}

		stats.Inserted++
		stats.RequestCharge += float64(resp.RequestCharge)
	}

	fmt.Printf("\nInsert complete — inserted: %d, skipped: %d, failed: %d\n", stats.Inserted, stats.Skipped, stats.Failed)
	fmt.Printf("Insert Request Charge: %.2f RUs\n\n", stats.RequestCharge)
	return stats, nil
}

