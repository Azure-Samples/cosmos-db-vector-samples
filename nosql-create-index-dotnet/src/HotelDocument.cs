using Newtonsoft.Json;

namespace NosqlCreateIndexDotnet;

public sealed class HotelDocument
{
    [JsonProperty("id")]
    public string? Id { get; set; }

    [JsonProperty("HotelId")]
    public string HotelId { get; set; } = string.Empty;

    [JsonProperty("HotelName")]
    public string HotelName { get; set; } = string.Empty;

    [JsonProperty("Description")]
    public string Description { get; set; } = string.Empty;

    [JsonProperty("DescriptionVector", NullValueHandling = NullValueHandling.Ignore)]
    public float[]? DescriptionVector { get; set; }

    [JsonProperty("embedding")]
    public float[]? Embedding { get; set; }

    [JsonProperty("Region")]
    public string Region { get; set; } = string.Empty;

    [JsonProperty("PartitionKey", NullValueHandling = NullValueHandling.Ignore)]
    public string? PartitionKey { get; set; }
}
