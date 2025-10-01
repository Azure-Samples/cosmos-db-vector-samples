using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using Newtonsoft.Json;

namespace CosmosDbVectorSamples.Models;

public class HotelData
{
    [BsonId]
    [JsonProperty("_id")]
    public ObjectId Id { get; set; }

    [JsonProperty("HotelId")]
    public string? HotelId { get; set; }

    [JsonProperty("HotelName")]
    public string? HotelName { get; set; }

    [JsonProperty("Description")]
    public string? Description { get; set; }

    [JsonProperty("Description_fr")]
    public string? DescriptionFr { get; set; }

    [JsonProperty("Category")]
    public string? Category { get; set; }

    [JsonProperty("Tags")]
    public List<string>? Tags { get; set; }

    [JsonProperty("ParkingIncluded")]
    public bool? ParkingIncluded { get; set; }

    [JsonProperty("SmokingAllowed")]
    public bool? SmokingAllowed { get; set; }

    [JsonProperty("LastRenovationDate")]
    public DateTime? LastRenovationDate { get; set; }

    [JsonProperty("Rating")]
    public double? Rating { get; set; }

    [JsonProperty("Location")]
    public LocationData? Location { get; set; }

    [JsonProperty("Address")]
    public AddressData? Address { get; set; }

    [JsonProperty("Rooms")]
    public List<RoomData>? Rooms { get; set; }

    // Embedding fields - will be added dynamically based on configuration
    [BsonExtraElements]
    [JsonExtensionData]
    public Dictionary<string, object>? ExtraElements { get; set; }
}

public class LocationData
{
    [JsonProperty("type")]
    public string? Type { get; set; }

    [JsonProperty("coordinates")]
    public List<double>? Coordinates { get; set; }
}

public class AddressData
{
    [JsonProperty("StreetAddress")]
    public string? StreetAddress { get; set; }

    [JsonProperty("City")]
    public string? City { get; set; }

    [JsonProperty("StateProvince")]
    public string? StateProvince { get; set; }

    [JsonProperty("PostalCode")]
    public string? PostalCode { get; set; }

    [JsonProperty("Country")]
    public string? Country { get; set; }
}

public class RoomData
{
    [JsonProperty("Description")]
    public string? Description { get; set; }

    [JsonProperty("Description_fr")]
    public string? DescriptionFr { get; set; }

    [JsonProperty("Type")]
    public string? Type { get; set; }

    [JsonProperty("BaseRate")]
    public double? BaseRate { get; set; }

    [JsonProperty("BedOptions")]
    public string? BedOptions { get; set; }

    [JsonProperty("SleepsCount")]
    public int? SleepsCount { get; set; }

    [JsonProperty("SmokingAllowed")]
    public bool? SmokingAllowed { get; set; }

    [JsonProperty("Tags")]
    public List<string>? Tags { get; set; }
}

public class SearchResult
{
    public HotelData? Document { get; set; }
    public double Score { get; set; }
}

public class InsertSummary
{
    public int Total { get; set; }
    public int Inserted { get; set; }
    public int Updated { get; set; }
    public int Skipped { get; set; }
    public int Failed { get; set; }
}