import { TOOL_NAME } from './prompts.js';
import { BaseMessage } from "@langchain/core/messages";

/**
 * Extracts the hotel search tool output from the planner agent's message history.
 * 
 * The planner agent calls the search_hotels_collection tool, which returns a 
 * formatted string containing hotel data. This function locates that tool's 
 * response message and extracts the content string.
 * 
 * @param plannerMessages - Array of messages from the planner agent execution
 * @returns The formatted hotel search results as a string, or empty string if not found
 */
export function extractPlannerToolOutput(plannerMessages: BaseMessage[]): string {
  const messages = plannerMessages || [];

  // Find the tool response message
  const toolMsg = messages.find((m: any) => {
    if (!m) return false;
    if (m?.name === TOOL_NAME) return true;
    if (m?.role === 'tool') return true;
    if (m?.tool_call_id) return true;
    return false;
  });

  if (!toolMsg) {
    console.warn(`Tool "${TOOL_NAME}" was not invoked by the planner agent.`);
    return '';
  }

  // Extract the tool's string content
  if (typeof toolMsg.content === 'string') {
    return toolMsg.content;
  }
  
  if (Array.isArray(toolMsg.content)) {
    return toolMsg.content
      .map((block: any) => block.text ?? JSON.stringify(block))
      .join('');
  }
  
  // Fallback: stringify object content
  return JSON.stringify(toolMsg.content);
}