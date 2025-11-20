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
