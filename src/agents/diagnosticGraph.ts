import { StateGraph, END, MemorySaver } from '@langchain/langgraph';
import { DiagnosticState, type DiagnosticStateType, type TriageResult } from './state';
import { triageNode } from './nodes/triageNode';
import { deepDiveNode } from './nodes/deepDiveNode';
import { summaryNode } from './nodes/summaryNode';
import { FileCheckpointer, type CheckpointData } from '../persistence/fileCheckpointer';

// Conditional edge function: determines whether to deep dive or go straight to summary
export function shouldDeepDive(state: DiagnosticStateType): 'deep_dive' | 'summary' {
  return state.needsDeepDive ? 'deep_dive' : 'summary';
}

export interface DiagnosticGraphOptions {
  checkpointer?: FileCheckpointer | undefined;
}

// Create the diagnostic graph
export function createDiagnosticGraph(options?: DiagnosticGraphOptions) {
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
      summary: 'summary'
    })
    .addEdge('deep_dive', 'summary')
    .addEdge('summary', END);

  // Use MemorySaver for LangGraph internal checkpointing
  const checkpointer = new MemorySaver();

  // Compile and return the graph
  return graph.compile({ checkpointer });
}

// Export the compiled graph as a singleton
let _graph: ReturnType<typeof createDiagnosticGraph> | null = null;

export function getDiagnosticGraph(options?: DiagnosticGraphOptions) {
  if (!_graph) {
    _graph = createDiagnosticGraph(options);
  }
  return _graph;
}

// Reset the singleton (useful for testing)
export function resetDiagnosticGraph(): void {
  _graph = null;
}

// Helper to convert state to checkpoint data
export function stateToCheckpointData(state: DiagnosticStateType): CheckpointData {
  const triageResult: TriageResult = {
    issues: state.issues,
    healthyPods: state.healthyPods,
    nodeStatus: state.nodeStatus,
    eventsSummary: state.eventsSummary,
  };

  return {
    namespace: state.namespace,
    timestamp: new Date().toISOString(),
    triageResult,
    deepDiveFindings: state.deepDiveFindings,
    metadata: {
      needsDeepDive: state.needsDeepDive,
      phase: state.phase,
    },
  };
}

// Helper to restore state from checkpoint data
export function checkpointDataToState(data: CheckpointData): Partial<DiagnosticStateType> {
  return {
    namespace: data.namespace,
    issues: data.triageResult?.issues || [],
    healthyPods: data.triageResult?.healthyPods || [],
    nodeStatus: data.triageResult?.nodeStatus || 'unknown',
    eventsSummary: data.triageResult?.eventsSummary || [],
    deepDiveFindings: data.deepDiveFindings || [],
    needsDeepDive: (data.metadata?.needsDeepDive as boolean) || false,
    phase: (data.metadata?.phase as DiagnosticStateType['phase']) || 'triage',
  };
}
