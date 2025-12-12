package com.azure.documentdb.samples;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * Represents hotel data with vector embeddings.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record HotelData(
    @JsonProperty("HotelId") String hotelId,
    @JsonProperty("HotelName") String hotelName,
    @JsonProperty("Description") String description,
    @JsonProperty("Category") String category,
    @JsonProperty("Tags") List<String> tags,
    @JsonProperty("ParkingIncluded") boolean parkingIncluded,
    @JsonProperty("SmokingAllowed") boolean smokingAllowed,
    @JsonProperty("LastRenovationDate") String lastRenovationDate,
    @JsonProperty("Rating") double rating,
    @JsonProperty("Address") Address address,
    @JsonProperty("text_embedding_ada_002") List<Double> textEmbeddingAda002
) {
    public record Address(
        @JsonProperty("StreetAddress") String streetAddress,
        @JsonProperty("City") String city,
        @JsonProperty("StateProvince") String stateProvince,
        @JsonProperty("PostalCode") String postalCode,
        @JsonProperty("Country") String country
    ) {}
}
