import { Annotation } from '@langchain/langgraph';
import type { DiagnosticIssue } from '../types/report';
import type { TriageIssue, TriageResult, NamespaceConstraints, DependencyHint } from '../types/triage';

export type { TriageIssue, TriageResult };

// Define the state annotation for the diagnostic graph
export const DiagnosticState = Annotation.Root({
  // Input
  namespace: Annotation<string>({
    reducer: (_, y) => y
  }),

  // LangGraph message history (unused by nodes, kept for graph compatibility)
  messages: Annotation<any[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Triage phase results
  triageResult: Annotation<TriageResult | null>({
    reducer: (_, y) => y,
    default: () => null
  }),

  // Namespace ResourceQuota and LimitRange constraints (fetched during triage)
  namespaceConstraints: Annotation<NamespaceConstraints | null>({
    reducer: (_, y) => y,
    default: () => null
  }),

  // Service dependency hints inferred from label matching (fetched during triage)
  dependencyHints: Annotation<DependencyHint[]>({
    reducer: (_, y) => y,
    default: () => []
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
