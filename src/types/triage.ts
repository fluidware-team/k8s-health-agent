import type { FilteredPod, FilteredNode, FilteredEvent } from './k8s';

// Represents an issue found during triage that needs investigation
export interface TriageIssue {
  podName: string;
  namespace: string;
  containerName?: string | undefined;
  reason: string;
  severity: 'critical' | 'warning' | 'info';
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
  // Filtered events from triage — used for cross-pod timestamp correlation
  eventsSummary: FilteredEvent[];
}

// ResourceQuota and LimitRange constraints for a namespace
export interface NamespaceConstraints {
  resourceQuotas: Array<{
    name: string;
    hard: Record<string, string>;
    used: Record<string, string>;
  }>;
  limitRanges: Array<{
    name: string;
    limits: Array<{
      type: string;
      default?: Record<string, string>;
      max?: Record<string, string>;
    }>;
  }>;
}

// Service dependency hint inferred from label matching and endpoint health
export interface DependencyHint {
  workload: string;
  hint: string;
}

// Data collected for triage analysis
export interface TriageData {
  pods: FilteredPod[];
  nodes: FilteredNode[];
  events: FilteredEvent[];
  namespaceConstraints?: NamespaceConstraints | null;
}
