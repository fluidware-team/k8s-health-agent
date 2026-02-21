import { describe, it, expect } from 'vitest';
import { collapseRepeatedIssues } from '../../src/utils/reportFormatter';
import { IssueSeverity, type DiagnosticIssue } from '../../src/types/report';

// Helper to build a minimal DiagnosticIssue
function makeIssue(overrides: Partial<DiagnosticIssue> & Pick<DiagnosticIssue, 'title' | 'resource'>): DiagnosticIssue {
  return {
    severity: IssueSeverity.CRITICAL,
    description: 'Pod is in bad state.',
    suggestedCommands: [`kubectl describe pod test -n default`],
    nextSteps: ['Check logs'],
    ...overrides
  };
}

describe('collapseRepeatedIssues', () => {
  it('returns issues unchanged when all have distinct reasons', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({ title: 'CrashLoopBackOff: Deployment/a', resource: { kind: 'Deployment', name: 'a' } }),
      makeIssue({ title: 'ImagePullBackOff: Deployment/b', resource: { kind: 'Deployment', name: 'b' } }),
      makeIssue({ title: 'OOMKilled: Deployment/c', resource: { kind: 'Deployment', name: 'c' } })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result).toHaveLength(3);
    expect(result[0]!.title).toBe('CrashLoopBackOff: Deployment/a');
    expect(result[1]!.title).toBe('ImagePullBackOff: Deployment/b');
    expect(result[2]!.title).toBe('OOMKilled: Deployment/c');
  });

  it('collapses two issues with the same reason and severity into one', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({ title: 'CrashLoopBackOff: Deployment/frontend', resource: { kind: 'Deployment', name: 'frontend' } }),
      makeIssue({ title: 'CrashLoopBackOff: Deployment/backend', resource: { kind: 'Deployment', name: 'backend' } })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('CrashLoopBackOff (2 workloads affected)');
  });

  it('collapses three issues with the same reason into one', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({ title: 'ImagePullBackOff: Deployment/a', resource: { kind: 'Deployment', name: 'a' } }),
      makeIssue({ title: 'ImagePullBackOff: Deployment/b', resource: { kind: 'Deployment', name: 'b' } }),
      makeIssue({ title: 'ImagePullBackOff: Deployment/c', resource: { kind: 'Deployment', name: 'c' } })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('ImagePullBackOff (3 workloads affected)');
  });

  it('does NOT collapse issues with the same reason but different severities', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/a',
        severity: IssueSeverity.CRITICAL,
        resource: { kind: 'Deployment', name: 'a' }
      }),
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/b',
        severity: IssueSeverity.WARNING,
        resource: { kind: 'Deployment', name: 'b' }
      })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result).toHaveLength(2);
  });

  it('passes a single-issue list through unchanged', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({ title: 'CrashLoopBackOff: Deployment/frontend', resource: { kind: 'Deployment', name: 'frontend' } })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('CrashLoopBackOff: Deployment/frontend');
  });

  it('returns empty array unchanged', () => {
    expect(collapseRepeatedIssues([])).toEqual([]);
  });

  it('collapsed issue description lists all affected workloads', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/frontend',
        resource: { kind: 'Deployment', name: 'frontend', namespace: 'default' }
      }),
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/backend',
        resource: { kind: 'Deployment', name: 'backend', namespace: 'default' }
      })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result[0]!.description).toContain('Deployment/frontend');
    expect(result[0]!.description).toContain('Deployment/backend');
  });

  it('collapsed issue merges affectedPods from all issues', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/frontend',
        resource: { kind: 'Deployment', name: 'frontend' },
        affectedPods: ['frontend-aaa', 'frontend-bbb']
      }),
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/backend',
        resource: { kind: 'Deployment', name: 'backend' },
        affectedPods: ['backend-ccc']
      })
    ];

    const result = collapseRepeatedIssues(issues);

    expect(result[0]!.affectedPods).toEqual(['frontend-aaa', 'frontend-bbb', 'backend-ccc']);
  });

  it('collapsed issue deduplicates suggestedCommands', () => {
    const sharedCmd = 'kubectl get nodes';
    const issues: DiagnosticIssue[] = [
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/a',
        resource: { kind: 'Deployment', name: 'a' },
        suggestedCommands: [sharedCmd, 'kubectl logs a-pod -n default']
      }),
      makeIssue({
        title: 'CrashLoopBackOff: Deployment/b',
        resource: { kind: 'Deployment', name: 'b' },
        suggestedCommands: [sharedCmd, 'kubectl logs b-pod -n default']
      })
    ];

    const result = collapseRepeatedIssues(issues);

    // sharedCmd should appear only once
    const cmds = result[0]!.suggestedCommands ?? [];
    expect(cmds.filter(c => c === sharedCmd)).toHaveLength(1);
    expect(cmds).toContain('kubectl logs a-pod -n default');
    expect(cmds).toContain('kubectl logs b-pod -n default');
  });

  it('collapsed issue deduplicates nextSteps', () => {
    const sharedStep = 'Check application logs';
    const issues: DiagnosticIssue[] = [
      makeIssue({
        title: 'OOMKilled: Deployment/a',
        resource: { kind: 'Deployment', name: 'a' },
        nextSteps: [sharedStep, 'Increase memory limit for a']
      }),
      makeIssue({
        title: 'OOMKilled: Deployment/b',
        resource: { kind: 'Deployment', name: 'b' },
        nextSteps: [sharedStep, 'Increase memory limit for b']
      })
    ];

    const result = collapseRepeatedIssues(issues);

    const steps = result[0]!.nextSteps ?? [];
    expect(steps.filter(s => s === sharedStep)).toHaveLength(1);
    expect(steps).toContain('Increase memory limit for a');
    expect(steps).toContain('Increase memory limit for b');
  });

  it('mixed: some reasons collapse, others do not', () => {
    const issues: DiagnosticIssue[] = [
      makeIssue({ title: 'CrashLoopBackOff: Deployment/a', resource: { kind: 'Deployment', name: 'a' } }),
      makeIssue({ title: 'CrashLoopBackOff: Deployment/b', resource: { kind: 'Deployment', name: 'b' } }),
      makeIssue({ title: 'OOMKilled: Deployment/c', resource: { kind: 'Deployment', name: 'c' } })
    ];

    const result = collapseRepeatedIssues(issues);

    // CrashLoopBackOff x2 → 1 collapsed; OOMKilled x1 → unchanged
    expect(result).toHaveLength(2);
    expect(result.some(i => i.title === 'CrashLoopBackOff (2 workloads affected)')).toBe(true);
    expect(result.some(i => i.title === 'OOMKilled: Deployment/c')).toBe(true);
  });
});
