
/**
 * Extracts the planner's tool output from an array of agent messages.
 *
 * This helper inspects the messages produced by the planner agent and attempts
 * to locate the message that represents the tool invocation result. The
 * planner tool in this project is named `search_hotels_collection` and the
 * LangChain/LLM runtime may represent the tool response in several shapes:
 *  - A message with `role: 'tool'` (typical tool message)
 *  - A message with `name: 'search_hotels_collection'`
 *  - A message that includes a `tool_call_id` or contains an array of
 *    content blocks (some SDKs return `content` as an array of objects)
 *
 * The function returns a single string containing the raw tool output. If
 * the tool message's `content` is already a string, that string is returned.
 * If `content` is an array, it concatenates text segments. If `content` is
 * an object, it returns the JSON stringified representation.
 *
 * The function throws an Error when no recognized tool message is found. The
 * caller should handle this by invoking the fallback path (for example,
 * perform the vector search programmatically) or by surfacing a clear
 * diagnostic to the user.
 *
 * Inputs
 *  - plannerMessages: array of messages returned by the planner agent
 *  - nearestNeighbors: optional numeric hint used by callers (not used here)
 *
 * Returns: rawToolContent string containing the tool output (possibly
 * stringified JSON). The content is not parsed — the caller is responsible
 * for parsing or further extraction.
 */
export function extractPlannerToolOutput(plannerMessages: any[], nearestNeighbors = 5) {
  const messages = plannerMessages || [];

  const toolMsg = messages.find((m: any) => {
    if (!m) return false;
    if (m?.name === 'search_hotels_collection') return true;
    if (m?.role === 'tool') return true;
    if (m?.tool_call_id) return true;
    return false;
  });

  // If the planner did not invoke the tool, throw an error so callers can handle it
  if (!toolMsg) {
    throw new Error('Planner did not invoke the tool "search_hotels_collection".');
  }

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
  return rawToolContent;
}
