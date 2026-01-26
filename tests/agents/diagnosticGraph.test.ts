import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the k8s client
vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    listNamespacedPod: vi.fn(),
    listNode: vi.fn(),
    listNamespacedEvent: vi.fn(),
    readNamespacedPodLog: vi.fn()
  }
}));

import { createDiagnosticGraph, shouldDeepDive, stateToCheckpointData, checkpointDataToState } from '../../src/agents/diagnosticGraph';
import { k8sCoreApi } from '../../src/cluster/k8sClient';
import type { DiagnosticStateType } from '../../src/agents/state';
import type { CheckpointData } from '../../src/persistence/fileCheckpointer';

describe('diagnosticGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldDeepDive', () => {
    it('should return "deep_dive" when needsDeepDive is true', () => {
      const state = {
        namespace: 'default',
        needsDeepDive: true,
        triageResult: {
          issues: [
            { podName: 'test', reason: 'CrashLoopBackOff', severity: 'critical' as const, namespace: 'default' }
          ],
          healthyPods: [],
          nodeStatus: 'healthy' as const,
          eventsSummary: []
        },
        messages: [],
        deepDiveFindings: [],
        issues: [],
        healthyResources: []
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
        healthyResources: []
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
            status: {
              phase: 'Running',
              containerStatuses: [{ name: 'main', ready: true, restartCount: 0, state: { running: {} } }]
            }
          }
        ]
      } as any);

      vi.mocked(k8sCoreApi.listNode).mockResolvedValue({
        items: [
          {
            metadata: { name: 'node-1' },
            status: { conditions: [{ type: 'Ready', status: 'True' }] }
          }
        ]
      } as any);

      vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue({
        items: []
      } as any);

      const graph = createDiagnosticGraph();

      const result = await graph.invoke(
        { namespace: 'default' },
        { configurable: { thread_id: 'test-thread-1' } }
      );

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
                  state: { waiting: { reason: 'CrashLoopBackOff', message: 'Back-off restarting' } }
                }
              ]
            }
          }
        ]
      } as any);

      vi.mocked(k8sCoreApi.listNode).mockResolvedValue({
        items: [
          {
            metadata: { name: 'node-1' },
            status: { conditions: [{ type: 'Ready', status: 'True' }] }
          }
        ]
      } as any);

      vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue({
        items: []
      } as any);

      vi.mocked(k8sCoreApi.readNamespacedPodLog).mockResolvedValue('Error: Connection refused');

      const graph = createDiagnosticGraph();

      const result = await graph.invoke(
        { namespace: 'default' },
        { configurable: { thread_id: 'test-thread-2' } }
      );

      expect(result.triageResult?.issues).toHaveLength(1);
      expect(result.needsDeepDive).toBe(true);
      expect(result.deepDiveFindings.length).toBeGreaterThan(0);
    });
  });

  describe('checkpoint conversion', () => {
    it('should convert state to checkpoint data', () => {
      const state: DiagnosticStateType = {
        namespace: 'production',
        issues: [{ podName: 'pod-1', namespace: 'production', reason: 'OOMKilled', severity: 'critical' }],
        healthyPods: ['pod-2', 'pod-3'],
        nodeStatus: 'healthy',
        eventsSummary: [{ type: 'Warning', reason: 'BackOff', message: 'Restarting' }],
        deepDiveFindings: ['Finding 1', 'Finding 2'],
        needsDeepDive: true,
        phase: 'summary',
        healthyResources: [],
        messages: [],
      };

      const checkpoint = stateToCheckpointData(state);

      expect(checkpoint.namespace).toBe('production');
      expect(checkpoint.timestamp).toBeDefined();
      expect(checkpoint.triageResult?.issues).toHaveLength(1);
      expect(checkpoint.triageResult?.healthyPods).toEqual(['pod-2', 'pod-3']);
      expect(checkpoint.triageResult?.nodeStatus).toBe('healthy');
      expect(checkpoint.deepDiveFindings).toEqual(['Finding 1', 'Finding 2']);
      expect(checkpoint.metadata?.needsDeepDive).toBe(true);
      expect(checkpoint.metadata?.phase).toBe('summary');
    });

    it('should convert checkpoint data back to state', () => {
      const checkpoint: CheckpointData = {
        namespace: 'staging',
        timestamp: '2024-01-01T00:00:00Z',
        triageResult: {
          issues: [{ podName: 'pod-x', namespace: 'staging', reason: 'CrashLoopBackOff', severity: 'warning' }],
          healthyPods: ['healthy-1'],
          nodeStatus: 'unhealthy',
          eventsSummary: [],
        },
        deepDiveFindings: ['Deep finding'],
        metadata: {
          needsDeepDive: false,
          phase: 'deep_dive',
        },
      };

      const state = checkpointDataToState(checkpoint);

      expect(state.namespace).toBe('staging');
      expect(state.issues).toHaveLength(1);
      expect(state.healthyPods).toEqual(['healthy-1']);
      expect(state.nodeStatus).toBe('unhealthy');
      expect(state.deepDiveFindings).toEqual(['Deep finding']);
      expect(state.needsDeepDive).toBe(false);
      expect(state.phase).toBe('deep_dive');
    });

    it('should handle missing fields in checkpoint data', () => {
      const checkpoint: CheckpointData = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const state = checkpointDataToState(checkpoint);

      expect(state.namespace).toBe('default');
      expect(state.issues).toEqual([]);
      expect(state.healthyPods).toEqual([]);
      expect(state.nodeStatus).toBe('unknown');
      expect(state.eventsSummary).toEqual([]);
      expect(state.deepDiveFindings).toEqual([]);
      expect(state.needsDeepDive).toBe(false);
      expect(state.phase).toBe('triage');
    });
  });
});
