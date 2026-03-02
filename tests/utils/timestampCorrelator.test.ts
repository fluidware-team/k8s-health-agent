import { describe, it, expect } from 'vitest';
import { correlatePodTimestamps } from '../../src/utils/timestampCorrelator';
import type { TriageIssue } from '../../src/types/triage';
import type { FilteredEvent } from '../../src/types/k8s';

function makeIssue(overrides: Partial<TriageIssue> & { podName: string }): TriageIssue {
  return {
    namespace: 'ns',
    reason: 'CrashLoopBackOff',
    severity: 'critical',
    ownerKind: 'Deployment',
    ownerName: 'gateway',
    ...overrides
  };
}

function makeEvent(podName: string, firstTimestamp: string): FilteredEvent {
  return {
    reason: 'BackOff',
    message: 'Back-off restarting failed container',
    type: 'Warning',
    firstTimestamp,
    involvedObject: { kind: 'Pod', name: podName, namespace: 'ns' }
  };
}

describe('correlatePodTimestamps', () => {
  it('should produce a correlation note when multiple pods in the same workload fail within a 5-min window', () => {
    const issues = [
      makeIssue({ podName: 'gw-aaa', ownerName: 'gateway' }),
      makeIssue({ podName: 'gw-bbb', ownerName: 'gateway' }),
      makeIssue({ podName: 'gw-ccc', ownerName: 'gateway' })
    ];
    const events = [
      makeEvent('gw-aaa', '2024-01-15T14:32:01Z'),
      makeEvent('gw-bbb', '2024-01-15T14:32:03Z'),
      makeEvent('gw-ccc', '2024-01-15T14:32:05Z')
    ];

    const notes = correlatePodTimestamps(issues, events);

    expect(notes).toHaveLength(1);
    expect(notes[0]!.workload).toBe('Deployment/gateway');
    expect(notes[0]!.note).toContain('3 pods');
    expect(notes[0]!.note).toContain('14:32');
  });

  it('should not produce a note when events are spread more than 5 minutes apart', () => {
    const issues = [
      makeIssue({ podName: 'gw-aaa', ownerName: 'gateway' }),
      makeIssue({ podName: 'gw-bbb', ownerName: 'gateway' })
    ];
    const events = [
      makeEvent('gw-aaa', '2024-01-15T14:00:00Z'),
      makeEvent('gw-bbb', '2024-01-15T14:10:00Z') // 10 min apart
    ];

    const notes = correlatePodTimestamps(issues, events);

    expect(notes).toHaveLength(0);
  });

  it('should not produce a note for single-pod workloads', () => {
    const issues = [makeIssue({ podName: 'solo-pod', ownerName: 'api', ownerKind: 'Deployment' })];
    const events = [makeEvent('solo-pod', '2024-01-15T14:32:00Z')];

    const notes = correlatePodTimestamps(issues, events);

    expect(notes).toHaveLength(0);
  });

  it('should return empty array when no events provided', () => {
    const issues = [
      makeIssue({ podName: 'gw-aaa', ownerName: 'gateway' }),
      makeIssue({ podName: 'gw-bbb', ownerName: 'gateway' })
    ];

    const notes = correlatePodTimestamps(issues, []);

    expect(notes).toHaveLength(0);
  });

  it('should handle issues without owner info (no crash)', () => {
    const issues = [
      { podName: 'standalone', namespace: 'ns', reason: 'CrashLoopBackOff', severity: 'critical' as const },
      { podName: 'standalone2', namespace: 'ns', reason: 'CrashLoopBackOff', severity: 'critical' as const }
    ];
    const events = [makeEvent('standalone', '2024-01-15T14:00:00Z')];

    // pods without ownerName are not grouped, so no correlation
    const notes = correlatePodTimestamps(issues, events);

    expect(notes).toHaveLength(0);
  });

  it('should handle multiple workloads with independent correlations', () => {
    const issues = [
      makeIssue({ podName: 'gw-aaa', ownerName: 'gateway', ownerKind: 'Deployment' }),
      makeIssue({ podName: 'gw-bbb', ownerName: 'gateway', ownerKind: 'Deployment' }),
      makeIssue({ podName: 'api-aaa', ownerName: 'api', ownerKind: 'Deployment' }),
      makeIssue({ podName: 'api-bbb', ownerName: 'api', ownerKind: 'Deployment' })
    ];
    const events = [
      makeEvent('gw-aaa', '2024-01-15T14:00:00Z'),
      makeEvent('gw-bbb', '2024-01-15T14:01:00Z'),
      makeEvent('api-aaa', '2024-01-15T15:00:00Z'),
      makeEvent('api-bbb', '2024-01-15T15:00:30Z')
    ];

    const notes = correlatePodTimestamps(issues, events);

    expect(notes).toHaveLength(2);
    const workloads = notes.map(n => n.workload);
    expect(workloads).toContain('Deployment/gateway');
    expect(workloads).toContain('Deployment/api');
  });
});
