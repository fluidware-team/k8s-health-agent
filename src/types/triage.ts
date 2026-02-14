import type { FilteredPod, FilteredNode, FilteredEvent } from './k8s';

// Represents an issue found during triage that needs investigation
export interface TriageIssue {
  podName: string;
  namespace: string;
  containerName?: string | undefined;
  reason: string;
  severity: 'critical' | 'warning';
  restarts?: number | undefined;
  message?: string | undefined;
  // Resolved owner workload (e.g. Deployment, StatefulSet, CronJob)
  ownerKind?: string | undefined;
  ownerName?: string | undefined;
}

// Represents triage results
export interface TriageResult {
  issues: TriageIssue[];
  healthyPods: string[];
  nodeStatus: 'healthy' | 'warning' | 'critical';
  eventsSummary: string[];
}

// Data collected for triage analysis
export interface TriageData {
  pods: FilteredPod[];
  nodes: FilteredNode[];
  events: FilteredEvent[];
}
