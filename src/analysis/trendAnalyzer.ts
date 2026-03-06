import { IssueSeverity, type DiagnosticIssue, type DiagnosticReport } from '../types/report';
import { extractReason } from '../utils/reportFormatter';

export interface IssueDiff {
  title: string;
  resource: string; // "Kind/name"
  severity: IssueSeverity;
}

export interface SnapshotDiff {
  previousTimestamp: string;
  newIssues: IssueDiff[];
  resolvedIssues: IssueDiff[];
  worsenedIssues: IssueDiff[];
  healthScore: number;
  previousHealthScore: number;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  [IssueSeverity.INFO]: 0,
  [IssueSeverity.WARNING]: 1,
  [IssueSeverity.CRITICAL]: 2
};

// Deduction per issue by severity. Health score starts at MAX_HEALTH_SCORE and floors at 0.
const MAX_HEALTH_SCORE = 100;
const SEVERITY_DEDUCTIONS: Record<IssueSeverity, number> = {
  [IssueSeverity.CRITICAL]: 30,
  [IssueSeverity.WARNING]: 10,
  [IssueSeverity.INFO]: 2
};

// Issue identity key: stable across runs for the same workload + reason.
function issueKey(issue: DiagnosticIssue): string {
  return `${issue.resource.kind}/${issue.resource.name}:${extractReason(issue.title)}`;
}

/**
 * Compute a health score (0–100) for a report.
 * Deducts points per issue by severity: critical=-30, warning=-10, info=-2.
 */
export function computeHealthScore(report: DiagnosticReport): number {
  const deduction = report.issues.reduce((sum, i) => sum + SEVERITY_DEDUCTIONS[i.severity], 0);
  return Math.max(0, MAX_HEALTH_SCORE - deduction);
}

/**
 * Diff two snapshots and classify each issue as new, resolved, or worsened.
 * Unchanged issues are not included in any list.
 */
export function diffSnapshots(previous: DiagnosticReport, current: DiagnosticReport): SnapshotDiff {
  const prevMap = new Map(previous.issues.map(i => [issueKey(i), i]));
  const currMap = new Map(current.issues.map(i => [issueKey(i), i]));

  const newIssues: IssueDiff[] = [];
  const resolvedIssues: IssueDiff[] = [];
  const worsenedIssues: IssueDiff[] = [];

  // New or worsened: in current
  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    const diff = {
      title: curr.title,
      resource: `${curr.resource.kind}/${curr.resource.name}`,
      severity: curr.severity
    };
    if (!prev) {
      newIssues.push(diff);
    } else if (SEVERITY_RANK[curr.severity] > SEVERITY_RANK[prev.severity]) {
      worsenedIssues.push(diff);
    }
  }

  // Resolved: in previous but not current
  for (const [key, prev] of prevMap) {
    if (!currMap.has(key)) {
      resolvedIssues.push({
        title: prev.title,
        resource: `${prev.resource.kind}/${prev.resource.name}`,
        severity: prev.severity
      });
    }
  }

  return {
    previousTimestamp: previous.timestamp,
    newIssues,
    resolvedIssues,
    worsenedIssues,
    healthScore: computeHealthScore(current),
    previousHealthScore: computeHealthScore(previous)
  };
}
