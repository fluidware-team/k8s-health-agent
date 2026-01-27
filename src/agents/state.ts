import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import type { DiagnosticIssue, HealthyResource } from '../types/report';

// Represents an issue found during triage that needs investigation
export interface TriageIssue {
  podName: string;
  namespace: string;
  containerName?: string | undefined;
  reason: string;
  severity: 'critical' | 'warning';
  restarts?: number | undefined;
  message?: string | undefined;
}

// Represents triage results
export interface TriageResult {
  issues: TriageIssue[];
  healthyPods: string[];
  nodeStatus: 'healthy' | 'warning' | 'critical';
  eventsSummary: string[];
}

// Define the state annotation for the diagnostic graph
export const DiagnosticState = Annotation.Root({
  // Input
  namespace: Annotation<string>({
    reducer: (_, y) => y,
  }),

  // LLM messages for conversation history
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  // Triage phase results
  triageResult: Annotation<TriageResult | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // Deep dive findings
  deepDiveFindings: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  // Final report data
  issues: Annotation<DiagnosticIssue[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  healthyResources: Annotation<HealthyResource[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),

  // Control flow
  needsDeepDive: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
});

export type DiagnosticStateType = typeof DiagnosticState.State;
