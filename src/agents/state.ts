import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import type { DiagnosticIssue, HealthyResource } from '../types/report';
import type { TriageIssue, TriageResult } from '../types/triage';

export type { TriageIssue, TriageResult };

// Define the state annotation for the diagnostic graph
export const DiagnosticState = Annotation.Root({
  // Input
  namespace: Annotation<string>({
    reducer: (_, y) => y
  }),

  // LLM messages for conversation history
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Triage phase results
  triageResult: Annotation<TriageResult | null>({
    reducer: (_, y) => y,
    default: () => null
  }),

  // Deep dive findings
  deepDiveFindings: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Final report data
  issues: Annotation<DiagnosticIssue[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  healthyResources: Annotation<HealthyResource[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Control flow
  needsDeepDive: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false
  })
});

export type DiagnosticStateType = typeof DiagnosticState.State;
