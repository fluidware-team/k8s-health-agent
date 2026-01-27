// Re-export all tools from both triage and deep dive for backward compatibility
export { listPodsTool, listNodesTool, listEventsTool, triageTools } from './triageTools';
export { readPodLogsTool, deepDiveTools } from './deepDiveTools';

// Export all tools combined
import { triageTools } from './triageTools';
import { deepDiveTools } from './deepDiveTools';

export const allTools = [...triageTools, ...deepDiveTools];
