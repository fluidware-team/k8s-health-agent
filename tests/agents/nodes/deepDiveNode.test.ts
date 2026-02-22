import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the deep dive tools
vi.mock('../../../src/tools/deepDiveTools', () => ({
  readPodLogsTool: { invoke: vi.fn() },
  getPodMetricsTool: { invoke: vi.fn() }
}));

import { deepDiveNode } from '../../../src/agents/nodes/deepDiveNode';
import { readPodLogsTool, getPodMetricsTool } from '../../../src/tools/deepDiveTools';
import type { DiagnosticStateType } from '../../../src/agents/state';

function makeState(overrides: Partial<DiagnosticStateType> = {}): DiagnosticStateType {
  return {
    namespace: 'default',
    needsDeepDive: true,
    triageResult: { issues: [], healthyPods: [], nodeStatus: 'healthy', eventsSummary: [] },
    messages: [],
    deepDiveFindings: [],
    llmAnalysis: '',
    issues: [],
    ...overrides
  };
}

describe('deepDiveNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty findings when no issues', async () => {
    const result = await deepDiveNode(makeState());

    expect(result.deepDiveFindings).toEqual([]);
  });

  it('should investigate critical issues with logs', async () => {
    vi.mocked(readPodLogsTool.invoke).mockResolvedValue('Error: connection refused');
    vi.mocked(getPodMetricsTool.invoke).mockResolvedValue('[]');

    const state = makeState({
      triageResult: {
        issues: [
          {
            podName: 'crash-pod',
            namespace: 'default',
            reason: 'CrashLoopBackOff',
            severity: 'critical',
            containerName: 'main'
          }
        ],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      }
    });

    const result = await deepDiveNode(state);

    expect(result.deepDiveFindings).toHaveLength(1);
    expect(result.deepDiveFindings![0]).toContain('crash-pod');
    expect(result.deepDiveFindings![0]).toContain('Error: connection refused');
    // CrashLoopBackOff should request previous logs
    expect(vi.mocked(readPodLogsTool.invoke)).toHaveBeenCalledWith(expect.objectContaining({ previous: true }));
  });

  it('should produce a clean error message when investigation fails', async () => {
    vi.mocked(readPodLogsTool.invoke).mockRejectedValue(new Error('socket hang up'));

    const state = makeState({
      triageResult: {
        issues: [
          {
            podName: 'broken-pod',
            namespace: 'default',
            reason: 'ImagePullBackOff',
            severity: 'critical'
          }
        ],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      }
    });

    const result = await deepDiveNode(state);

    expect(result.deepDiveFindings).toHaveLength(1);
    expect(result.deepDiveFindings![0]).toContain('Investigation failed for broken-pod');
    expect(result.deepDiveFindings![0]).toContain('socket hang up');
    // Should NOT contain raw [object Object] or stack traces
    expect(result.deepDiveFindings![0]).not.toContain('[object');
  });

  it('should limit investigations to 5 issues', async () => {
    vi.mocked(readPodLogsTool.invoke).mockResolvedValue('some logs');

    const issues = Array.from({ length: 8 }, (_, i) => ({
      podName: `pod-${i}`,
      namespace: 'default',
      reason: 'CrashLoopBackOff' as const,
      severity: 'critical' as const
    }));

    const state = makeState({
      triageResult: { issues, healthyPods: [], nodeStatus: 'healthy', eventsSummary: [] }
    });

    const result = await deepDiveNode(state);

    expect(result.deepDiveFindings).toHaveLength(5);
  });
});
