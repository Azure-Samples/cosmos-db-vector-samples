// Diagnostic callbacks array to log agent decisions and tool usage


const agentCallbacks = [
    {
        handleLLMStart: async (_llm, prompts) => {
            console.log('[planner][LLM start] prompts=', Array.isArray(prompts) ? prompts.length : 1);
        },
        // stream tokens (helps you see what model was generating before deciding)
        handleLLMNewToken: async (token: string) => {
        try { process.stdout.write(token); } catch (e) {}
        },
        handleLLMEnd: async (output) => {
        try {
            console.log('\n[planner][LLM end] output keys=', Object.keys(output || {}));
            // Many model responses include tool_calls metadata on output.additional_kwargs or output.tool_calls
            if (output?.additional_kwargs?.tool_calls) {
            console.log('[planner][LLM end] additional_kwargs.tool_calls=', JSON.stringify(output.additional_kwargs.tool_calls, null, 2));
            }
            if (output?.tool_calls) {
            console.log('[planner][LLM end] tool_calls=', JSON.stringify(output.tool_calls, null, 2));
            }
        } catch (e) { /* ignore */ }
        },
        handleLLMError: async (err) => {
            console.error('[planner][LLM error]', err);
        },
        handleAgentAction: async (action) => {
        try {
            const toolName = action?.tool?.name ?? action?.tool ?? 'unknown';
            const input = action?.input ? (typeof action.input === 'string' ? action.input : JSON.stringify(action.input)) : '';
            console.log(`[planner][Agent Decision] tool=${toolName} input=${input}`);
        } catch (e) { /* ignore */ }
        },
        handleAgentEnd: async (output) => {
        try {
            console.log('[planner][Agent End] output=', JSON.stringify(output ?? {}, null, 2));
        } catch (e) {}
        },
        handleToolStart: async (tool) => {
            console.log('[planner][Tool Start]', typeof tool === 'string' ? tool : (tool?.name ?? JSON.stringify(tool)));
        },
        handleToolEnd: async (output) => {
        try {
            const summary = typeof output === 'string' ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);
            console.log('[planner][Tool End] output summary=', summary);
        } catch (e) { /* ignore */ }
        },
        handleToolError: async (err) => {
        console.error('[planner][Tool Error]', err);
        }
    }
];

export const DEBUG_CALLBACKS = process.env.DEBUG === 'true' ? agentCallbacks : [];

