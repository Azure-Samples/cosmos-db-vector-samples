using System.Text.Json;
using System.Text.Json.Serialization;

namespace NosqlCreateIndexDotnet;

public sealed class HotelDocument
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("HotelId")]
    public string HotelId { get; set; } = string.Empty;

    [JsonPropertyName("HotelName")]
    public string HotelName { get; set; } = string.Empty;

    [JsonPropertyName("Description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("DescriptionVector")]
    public float[]? DescriptionVector { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }
}
