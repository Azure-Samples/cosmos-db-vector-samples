package models

import "time"

// Address represents a hotel address
type Address struct {
	StreetAddress string `json:"StreetAddress" bson:"StreetAddress"`
	City          string `json:"City" bson:"City"`
	StateProvince string `json:"StateProvince" bson:"StateProvince"`
	PostalCode    string `json:"PostalCode" bson:"PostalCode"`
	Country       string `json:"Country" bson:"Country"`
}

// Hotel represents a hotel document (full model from JSON file)
type Hotel struct {
	HotelID            string    `json:"HotelId" bson:"HotelId"`
	HotelName          string    `json:"HotelName" bson:"HotelName"`
	Description        string    `json:"Description" bson:"Description"`
	DescriptionFr      string    `json:"Description_fr,omitempty" bson:"Description_fr,omitempty"`
	Category           string    `json:"Category" bson:"Category"`
	Tags               []string  `json:"Tags" bson:"Tags"`
	ParkingIncluded    bool      `json:"ParkingIncluded" bson:"ParkingIncluded"`
	IsDeleted          bool      `json:"IsDeleted" bson:"IsDeleted"`
	LastRenovationDate time.Time `json:"LastRenovationDate" bson:"LastRenovationDate"`
	Rating             float64   `json:"Rating" bson:"Rating"`
	Address            Address   `json:"Address" bson:"Address"`
	Location           *struct {
		Type        string    `json:"type" bson:"type"`
		Coordinates []float64 `json:"coordinates" bson:"coordinates"`
	} `json:"Location,omitempty" bson:"Location,omitempty"`
	Rooms []any `json:"Rooms,omitempty" bson:"Rooms,omitempty"`
}

// HotelForVectorStore represents hotel data stored in vector database (excludes certain fields)
type HotelForVectorStore struct {
	HotelID            string    `json:"HotelId" bson:"HotelId"`
	HotelName          string    `json:"HotelName" bson:"HotelName"`
	Description        string    `json:"Description" bson:"Description"`
	Category           string    `json:"Category" bson:"Category"`
	Tags               []string  `json:"Tags" bson:"Tags"`
	ParkingIncluded    bool      `json:"ParkingIncluded" bson:"ParkingIncluded"`
	IsDeleted          bool      `json:"IsDeleted" bson:"IsDeleted"`
	LastRenovationDate time.Time `json:"LastRenovationDate" bson:"LastRenovationDate"`
	Rating             float64   `json:"Rating" bson:"Rating"`
	Address            Address   `json:"Address" bson:"Address"`
	ContentVector      []float32 `json:"contentVector,omitempty" bson:"contentVector,omitempty"`
}

// HotelSearchResult represents a hotel with similarity score
type HotelSearchResult struct {
	Hotel HotelForVectorStore
	Score float64
}

// ToVectorStore converts a Hotel to HotelForVectorStore (excludes certain fields)
func (h *Hotel) ToVectorStore() HotelForVectorStore {
	return HotelForVectorStore{
		HotelID:            h.HotelID,
		HotelName:          h.HotelName,
		Description:        h.Description,
		Category:           h.Category,
		Tags:               h.Tags,
		ParkingIncluded:    h.ParkingIncluded,
		IsDeleted:          h.IsDeleted,
		LastRenovationDate: h.LastRenovationDate,
		Rating:             h.Rating,
		Address:            h.Address,
	}
}

// PageContent generates the text content for embedding
func (h *Hotel) PageContent() string {
	return "Hotel: " + h.HotelName + "\n\n" + h.Description
}
