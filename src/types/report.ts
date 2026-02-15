export enum IssueSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info'
}

export interface ResourceReference {
  kind: string;
  name: string;
  namespace?: string;
}

export interface HealthyResource {
  kind: string;
  name: string;
  status: string;
}

export interface DiagnosticIssue {
  severity: IssueSeverity;
  title: string;
  description: string;
  resource: ResourceReference;
  affectedPods?: string[];
  suggestedCommands?: string[];
  nextSteps?: string[];
  proposedSolution?: string;
}

export interface DiagnosticReport {
  namespace: string;
  timestamp: string;
  summary: string;
  issues: DiagnosticIssue[];
  healthyResources: HealthyResource[];
  llmAnalysis?: string;
}
