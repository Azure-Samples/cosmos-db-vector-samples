export function extractPlannerToolOutput(plannerMessages: any[], nearestNeighbors = 5) {
  const messages = plannerMessages || [];

  const toolMsg = messages.find((m: any) => {
    if (!m) return false;
    if (m?.name === 'search_hotels_collection') return true;
    if (m?.role === 'tool') return true;
    if (m?.tool_call_id) return true;
    return false;
  });

  const lastMessage = messages[messages.length - 1];

  // Extract raw tool string (may already be a stringified JSON)
  let rawToolContent = '';
  if (toolMsg) {
    if (typeof toolMsg.content === 'string') {
      rawToolContent = toolMsg.content;
    } else if (Array.isArray(toolMsg.content)) {
      rawToolContent = toolMsg.content.map((b: any) => b.text ?? JSON.stringify(b)).join('');
    } else {
      rawToolContent = JSON.stringify(toolMsg.content);
    }
  } else if (lastMessage) {
    if (typeof lastMessage.content === 'string') {
      rawToolContent = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      rawToolContent = lastMessage.content.map((b: any) => b.text || '').join('');
    } else {
      rawToolContent = JSON.stringify(lastMessage.content || '');
    }
  }

  // Try to parse the raw tool content as JSON
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawToolContent || 'null');
  } catch (e) {
    parsed = null;
  }

  // If parsed is an array of hotels, deduplicate by HotelId and select top N by Score
  let dedupedTopN: any[] | null = null;
  if (Array.isArray(parsed) && parsed.length > 0) {
    const hotelsArr = parsed as any[];

    // Build map HotelId -> best hotel (highest Score)
    const bestById = new Map<string | number, any>();
    for (const h of hotelsArr) {
      const id = h?.HotelId ?? h?.id ?? null;
      if (id == null) {
        // fallback: include items with no id under a synthetic index key
        const key = `__noid__${Math.random().toString(36).slice(2, 8)}`;
        bestById.set(key, h);
        continue;
      }
      const existing = bestById.get(id);
      if (!existing) {
        bestById.set(id, h);
      } else {
        // prefer the one with higher Score
        const existingScore = Number(existing?.Score ?? -Infinity);
        const thisScore = Number(h?.Score ?? -Infinity);
        if (thisScore > existingScore) {
          bestById.set(id, h);
        }
      }
    }

    // Produce array and sort by Score desc
    const uniqueHotels = Array.from(bestById.values());
    uniqueHotels.sort((a, b) => (Number(b?.Score ?? 0) - Number(a?.Score ?? 0)));

    // Take top N according to nearestNeighbors
    dedupedTopN = uniqueHotels.slice(0, nearestNeighbors);

    // Replace parsed with the deduped top-N array for downstream use
    parsed = dedupedTopN;
  }

  // If parsed could not be created, parsed remains null

  // Now build the toolContent text that the synthesizer should receive.
  // If we have dedupedTopN, construct Names: line + formatted blocks + append full JSON
  let toolContent = rawToolContent;
  if (Array.isArray(parsed) && parsed.length > 0) {
    const top = parsed as any[];

    const namesLine = `Names: ${top.map(h => h.HotelName ?? h.HotelId ?? 'Unknown').join('; ')}`;

    const formatHotel = (h: any) => {
      const tags = Array.isArray(h.Tags) ? h.Tags.join(', ') : (h.Tags ?? '');
      const city = h.Address?.City ?? '';
      const state = h.Address?.StateProvince ?? '';
      const location = `${city}${state ? ', ' + state : ''}`.trim() || 'N/A';
      return [
        `Name: ${h.HotelName ?? 'N/A'}`,
        `HotelId: ${h.HotelId ?? 'N/A'}`,
        `Rating: ${h.Rating ?? 'N/A'}`,
        `Score: ${(h.Score ?? 0).toFixed(6)}`,
        `Location: ${location}`,
        `Category: ${h.Category ?? 'N/A'}`,
        `Tags: ${tags || 'N/A'}`,
        `ParkingIncluded: ${h.ParkingIncluded ?? false}`,
        `IsDeleted: ${h.IsDeleted ?? false}`,
        `LastRenovationDate: ${h.LastRenovationDate ?? 'N/A'}`,
        `Description: ${h.Description ?? ''}`.trim()
      ].join('\n');
    };

    const summary = top.map(formatHotel).join('\n\n');

    toolContent = `${namesLine}\n\n${summary}\n\nFullResultsJSON:\n${rawToolContent}`;
  }

  return {
    plannerMessages: messages,
    toolMsg,
    lastMessage,
    // `toolContent` is the text the synthesizer should receive (summary + appended JSON when available)
    toolContent,
    // `parsed` is now the deduped top-N array when possible (or null)
    parsed,
    // number of unique hotels found before slicing to nearestNeighbors (if parsed was array)
    uniqueCount: Array.isArray(parsed) ? parsed.length : 0,
    nearestNeighborsRequested: nearestNeighbors,
  };
}