import { StateGraph, END } from '@langchain/langgraph';
import { DiagnosticState, type DiagnosticStateType } from './state';
import { triageNode } from './nodes/triageNode';
import { deepDiveNode } from './nodes/deepDiveNode';
import { summaryNode } from './nodes/summaryNode';

// Conditional edge function: determines whether to deep dive or go straight to summary
export function shouldDeepDive(state: DiagnosticStateType): 'deep_dive' | 'summary' {
  return state.needsDeepDive ? 'deep_dive' : 'summary';
}

// Create the diagnostic graph
export function createDiagnosticGraph() {
  // Create a new graph with our state annotation
  const graph = new StateGraph(DiagnosticState)
    // Add nodes
    .addNode('triage', triageNode)
    .addNode('deep_dive', deepDiveNode)
    .addNode('summary', summaryNode)

    // Add edges
    .addEdge('__start__', 'triage')
    .addConditionalEdges('triage', shouldDeepDive, {
      deep_dive: 'deep_dive',
      summary: 'summary',
    })
    .addEdge('deep_dive', 'summary')
    .addEdge('summary', END);

  // Compile and return the graph
  return graph.compile();
}

// Export the compiled graph as a singleton
let _graph: ReturnType<typeof createDiagnosticGraph> | null = null;

export function getDiagnosticGraph() {
  if (!_graph) {
    _graph = createDiagnosticGraph();
  }
  return _graph;
}
