// Diagnostic callbacks array to log agent decisions and tool usage


const agentCallbacks = [
    {
        handleLLMStart: async (_llm, prompts) => {
            console.log('[planner][LLM start] prompts=', Array.isArray(prompts) ? prompts.length : 1);
        },
        handleLLMEnd: async (_output) => {
            console.log('[planner][LLM end]');
        },
        handleLLMError: async (err) => {
            console.error('[planner][LLM error]', err);
        },
        handleAgentAction: async (action) => {
            try {
                const toolName = action?.tool?.name ?? action?.tool ?? 'unknown';
                const input = action?.input ? (typeof action.input === 'string' ? action.input : JSON.stringify(action.input)) : '';
                console.log(`[planner][Agent Decision] tool=${toolName} input=${input}`);
            }
            catch (e) { /* ignore */ }
        },
        handleToolStart: async (tool) => {
            console.log('[planner][Tool Start]', typeof tool === 'string' ? tool : (tool?.name ?? JSON.stringify(tool)));
        },
        handleToolEnd: async (output) => {
            try {
                const summary = typeof output === 'string' ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);
                console.log('[planner][Tool End] output summary=', summary);
            }
            catch (e) { /* ignore */ }
        }
    }
];

export const callbacks = process.env.DEBUG === 'true' ? agentCallbacks : [];

