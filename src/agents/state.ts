import { Annotation } from '@langchain/langgraph';
import type { DiagnosticIssue } from '../types/report';
import type { TriageIssue, TriageResult } from '../types/triage';

export type { TriageIssue, TriageResult };

// Define the state annotation for the diagnostic graph
export const DiagnosticState = Annotation.Root({
  // Input
  namespace: Annotation<string>({
    reducer: (_, y) => y
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

  // LLM analysis results (root-cause hypotheses and remediation steps)
  llmAnalysis: Annotation<string>({
    reducer: (_, y) => y,
    default: () => ''
  }),

  // Final report data
  issues: Annotation<DiagnosticIssue[]>({
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
