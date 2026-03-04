import { describe, it, expect } from 'vitest';
import { computeHealthScore, diffSnapshots } from '../../src/analysis/trendAnalyzer';
import { IssueSeverity, type DiagnosticReport } from '../../src/types/report';

function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    namespace: 'production',
    timestamp: '2026-03-04T14:00:00.000Z',
    summary: '',
    issues: [],
    ...overrides
  };
}

const CRITICAL_ISSUE = {
  severity: IssueSeverity.CRITICAL,
  title: 'CrashLoopBackOff: Deployment/gateway',
  description: 'Pod crashing.',
  resource: { kind: 'Deployment', name: 'gateway', namespace: 'production' }
};

const WARNING_ISSUE = {
  severity: IssueSeverity.WARNING,
  title: 'HighRestartCount: Deployment/worker',
  description: 'High restarts.',
  resource: { kind: 'Deployment', name: 'worker', namespace: 'production' }
};

const INFO_ISSUE = {
  severity: IssueSeverity.INFO,
  title: 'Failed: Job/cleanup',
  description: 'Job failed.',
  resource: { kind: 'Job', name: 'cleanup', namespace: 'production' }
};

describe('computeHealthScore', () => {
  it('should return 100 for a healthy namespace with no issues', () => {
    expect(computeHealthScore(makeReport())).toBe(100);
  });

  it('should deduct 30 per critical issue', () => {
    const report = makeReport({ issues: [CRITICAL_ISSUE, CRITICAL_ISSUE] });
    expect(computeHealthScore(report)).toBe(40);
  });

  it('should deduct 10 per warning issue', () => {
    const report = makeReport({ issues: [WARNING_ISSUE, WARNING_ISSUE] });
    expect(computeHealthScore(report)).toBe(80);
  });

  it('should deduct 2 per info issue', () => {
    const report = makeReport({ issues: [INFO_ISSUE] });
    expect(computeHealthScore(report)).toBe(98);
  });

  it('should floor at 0 for many critical issues', () => {
    const issues = Array.from({ length: 10 }, () => CRITICAL_ISSUE);
    expect(computeHealthScore(makeReport({ issues }))).toBe(0);
  });

  it('should combine deductions across severities', () => {
    const report = makeReport({ issues: [CRITICAL_ISSUE, WARNING_ISSUE, INFO_ISSUE] });
    // 100 - 30 - 10 - 2 = 58
    expect(computeHealthScore(report)).toBe(58);
  });
});

describe('diffSnapshots', () => {
  it('should identify new issues that appear in current but not previous', () => {
    const previous = makeReport({ issues: [] });
    const current = makeReport({ issues: [CRITICAL_ISSUE], timestamp: '2026-03-04T15:00:00.000Z' });

    const diff = diffSnapshots(previous, current);

    expect(diff.newIssues).toHaveLength(1);
    expect(diff.newIssues[0]!.title).toBe(CRITICAL_ISSUE.title);
    expect(diff.resolvedIssues).toHaveLength(0);
    expect(diff.worsenedIssues).toHaveLength(0);
  });

  it('should identify resolved issues that were in previous but not current', () => {
    const previous = makeReport({ issues: [CRITICAL_ISSUE] });
    const current = makeReport({ issues: [], timestamp: '2026-03-04T15:00:00.000Z' });

    const diff = diffSnapshots(previous, current);

    expect(diff.resolvedIssues).toHaveLength(1);
    expect(diff.resolvedIssues[0]!.title).toBe(CRITICAL_ISSUE.title);
    expect(diff.newIssues).toHaveLength(0);
  });

  it('should identify worsened issues when severity escalates', () => {
    const previousIssue = { ...WARNING_ISSUE, resource: { ...WARNING_ISSUE.resource, name: 'gateway' }, title: 'HighRestartCount: Deployment/gateway' };
    const currentIssue = { ...CRITICAL_ISSUE, resource: { ...CRITICAL_ISSUE.resource, name: 'gateway' }, title: 'CrashLoopBackOff: Deployment/gateway' };

    // Same workload (Deployment/gateway), but reason changed and severity escalated
    // Actually worsened is about same key having higher severity.
    // Let's use same title/resource but upgraded severity:
    const prevWarning = { ...WARNING_ISSUE };
    const currCritical = { ...WARNING_ISSUE, severity: IssueSeverity.CRITICAL };

    const previous = makeReport({ issues: [prevWarning] });
    const current = makeReport({ issues: [currCritical], timestamp: '2026-03-04T15:00:00.000Z' });

    const diff = diffSnapshots(previous, current);

    expect(diff.worsenedIssues).toHaveLength(1);
    expect(diff.worsenedIssues[0]!.title).toBe(WARNING_ISSUE.title);
    expect(diff.newIssues).toHaveLength(0);
    expect(diff.resolvedIssues).toHaveLength(0);
  });

  it('should not flag unchanged issues', () => {
    const previous = makeReport({ issues: [CRITICAL_ISSUE] });
    const current = makeReport({ issues: [CRITICAL_ISSUE], timestamp: '2026-03-04T15:00:00.000Z' });

    const diff = diffSnapshots(previous, current);

    expect(diff.newIssues).toHaveLength(0);
    expect(diff.resolvedIssues).toHaveLength(0);
    expect(diff.worsenedIssues).toHaveLength(0);
  });

  it('should include previousTimestamp from the previous report', () => {
    const previous = makeReport({ timestamp: '2026-03-04T12:00:00.000Z' });
    const current = makeReport({ timestamp: '2026-03-04T15:00:00.000Z' });

    const diff = diffSnapshots(previous, current);

    expect(diff.previousTimestamp).toBe('2026-03-04T12:00:00.000Z');
  });

  it('should include health scores for both snapshots', () => {
    const previous = makeReport({ issues: [CRITICAL_ISSUE] }); // score: 70
    const current = makeReport({ issues: [], timestamp: '2026-03-04T15:00:00.000Z' }); // score: 100

    const diff = diffSnapshots(previous, current);

    expect(diff.previousHealthScore).toBe(70);
    expect(diff.healthScore).toBe(100);
  });
});
