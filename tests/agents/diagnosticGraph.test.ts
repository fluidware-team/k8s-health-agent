import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the k8s client
vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    listNamespacedPod: vi.fn(),
    listNode: vi.fn(),
    listNamespacedEvent: vi.fn(),
    readNamespacedPodLog: vi.fn(),
  },
}));

import { createDiagnosticGraph, shouldDeepDive } from '../../src/agents/diagnosticGraph';
import { k8sCoreApi } from '../../src/cluster/k8sClient';
import type { DiagnosticStateType } from '../../src/agents/state';

describe('diagnosticGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldDeepDive', () => {
    it('should return "deep_dive" when needsDeepDive is true', () => {
      const state = {
        namespace: 'default',
        needsDeepDive: true,
        triageResult: { issues: [{ podName: 'test', reason: 'CrashLoopBackOff', severity: 'critical' as const, namespace: 'default' }], healthyPods: [], nodeStatus: 'healthy' as const, eventsSummary: [] },
        messages: [],
        deepDiveFindings: [],
        issues: [],
        healthyResources: [],
      };

      expect(shouldDeepDive(state)).toBe('deep_dive');
    });

    it('should return "summary" when needsDeepDive is false', () => {
      const state = {
        namespace: 'default',
        needsDeepDive: false,
        triageResult: { issues: [], healthyPods: ['healthy-pod'], nodeStatus: 'healthy' as const, eventsSummary: [] },
        messages: [],
        deepDiveFindings: [],
        issues: [],
        healthyResources: [],
      };

      expect(shouldDeepDive(state)).toBe('summary');
    });
  });

  describe('createDiagnosticGraph', () => {
    it('should create a graph that can be invoked', async () => {
      // Mock healthy cluster
      vi.mocked(k8sCoreApi.listNamespacedPod).mockResolvedValue({
        items: [
          {
            metadata: { name: 'healthy-pod', namespace: 'default' },
            spec: { containers: [{ name: 'main', image: 'nginx' }] },
            status: { phase: 'Running', containerStatuses: [{ name: 'main', ready: true, restartCount: 0, state: { running: {} } }] },
          },
        ],
      } as any);

      vi.mocked(k8sCoreApi.listNode).mockResolvedValue({
        items: [
          {
            metadata: { name: 'node-1' },
            status: { conditions: [{ type: 'Ready', status: 'True' }] },
          },
        ],
      } as any);

      vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue({
        items: [],
      } as any);

      const graph = createDiagnosticGraph();

      const result = await graph.invoke({ namespace: 'default' });

      expect(result.triageResult).toBeDefined();
      expect(result.triageResult?.issues).toHaveLength(0);
      expect(result.needsDeepDive).toBe(false);
    });

    it('should perform deep dive when issues are found', async () => {
      // Mock cluster with issues
      vi.mocked(k8sCoreApi.listNamespacedPod).mockResolvedValue({
        items: [
          {
            metadata: { name: 'crash-pod', namespace: 'default' },
            spec: { containers: [{ name: 'main', image: 'broken' }] },
            status: {
              phase: 'Running',
              containerStatuses: [
                {
                  name: 'main',
                  ready: false,
                  restartCount: 10,
                  state: { waiting: { reason: 'CrashLoopBackOff', message: 'Back-off restarting' } },
                },
              ],
            },
          },
        ],
      } as any);

      vi.mocked(k8sCoreApi.listNode).mockResolvedValue({
        items: [
          {
            metadata: { name: 'node-1' },
            status: { conditions: [{ type: 'Ready', status: 'True' }] },
          },
        ],
      } as any);

      vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue({
        items: [],
      } as any);

      vi.mocked(k8sCoreApi.readNamespacedPodLog).mockResolvedValue('Error: Connection refused');

      const graph = createDiagnosticGraph();

      const result = await graph.invoke({ namespace: 'default' });

      expect(result.triageResult?.issues).toHaveLength(1);
      expect(result.needsDeepDive).toBe(true);
      expect(result.deepDiveFindings.length).toBeGreaterThan(0);
    });
  });
});
