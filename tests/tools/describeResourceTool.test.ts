import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the k8s client
vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    readNamespacedPod: vi.fn(),
    listNamespacedEvent: vi.fn()
  },
  k8sAppsApi: {
    readNamespacedDeployment: vi.fn(),
    readNamespacedStatefulSet: vi.fn(),
    readNamespacedDaemonSet: vi.fn()
  }
}));

import { describeResourceTool } from '../../src/tools/investigationTools';
import { k8sCoreApi, k8sAppsApi } from '../../src/cluster/k8sClient';

// Minimal event list response with no events
const emptyEvents = { items: [] };

// A warning event attached to the resource under test
function makeWarningEvent(resourceName: string, reason: string, message: string) {
  return {
    type: 'Warning',
    reason,
    message,
    involvedObject: { name: resourceName, kind: 'Pod' },
    lastTimestamp: '2024-01-01T00:05:00Z',
    count: 3
  };
}

describe('describeResourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue(emptyEvents as any);
  });

  describe('pod', () => {
    it('returns phase and container state', async () => {
      vi.mocked(k8sCoreApi.readNamespacedPod).mockResolvedValue({
        status: {
          phase: 'Running',
          conditions: [{ type: 'Ready', status: 'True' }],
          containerStatuses: [
            { name: 'main', ready: true, restartCount: 0, state: { running: { startedAt: '2024-01-01T00:00:00Z' } } }
          ]
        }
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'pod', name: 'my-pod', namespace: 'default' });

      expect(result).toContain('pod/my-pod');
      expect(result).toContain('Phase: Running');
      expect(result).toContain('main');
      expect(result).toContain('restarts=0');
    });

    it('shows crash state and restart count', async () => {
      vi.mocked(k8sCoreApi.readNamespacedPod).mockResolvedValue({
        status: {
          phase: 'Running',
          conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
          containerStatuses: [
            {
              name: 'app',
              ready: false,
              restartCount: 12,
              state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off restarting' } }
            }
          ]
        }
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'pod', name: 'crash-pod', namespace: 'default' });

      expect(result).toContain('restarts=12');
      expect(result).toContain('CrashLoopBackOff');
      expect(result).toContain('ContainersNotReady');
    });
  });

  describe('deployment', () => {
    it('returns replica counts and conditions', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockResolvedValue({
        spec: { replicas: 3, strategy: { type: 'RollingUpdate' } },
        status: {
          replicas: 3,
          readyReplicas: 1,
          availableReplicas: 1,
          updatedReplicas: 3,
          conditions: [
            {
              type: 'Available',
              status: 'False',
              reason: 'MinimumReplicasUnavailable',
              message: 'Deployment does not have minimum availability.'
            }
          ]
        }
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'deployment', name: 'gateway', namespace: 'default' });

      expect(result).toContain('deployment/gateway');
      expect(result).toContain('3 desired');
      expect(result).toContain('1 ready');
      expect(result).toContain('RollingUpdate');
      expect(result).toContain('Available=False');
      expect(result).toContain('MinimumReplicasUnavailable');
    });
  });

  describe('statefulset', () => {
    it('returns replica counts', async () => {
      vi.mocked(k8sAppsApi.readNamespacedStatefulSet).mockResolvedValue({
        spec: { replicas: 3 },
        status: { replicas: 3, readyReplicas: 2, currentReplicas: 3 }
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'statefulset', name: 'rabbitmq', namespace: 'default' });

      expect(result).toContain('statefulset/rabbitmq');
      expect(result).toContain('3 desired');
      expect(result).toContain('2 ready');
    });
  });

  describe('daemonset', () => {
    it('returns scheduled/ready counts', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDaemonSet).mockResolvedValue({
        status: {
          desiredNumberScheduled: 4,
          numberReady: 3,
          numberAvailable: 3,
          numberMisscheduled: 0
        }
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'daemonset', name: 'fluentd', namespace: 'default' });

      expect(result).toContain('daemonset/fluentd');
      expect(result).toContain('4 desired');
      expect(result).toContain('3 ready');
    });
  });

  describe('events', () => {
    it('includes warning events for the resource', async () => {
      vi.mocked(k8sCoreApi.readNamespacedPod).mockResolvedValue({
        status: { phase: 'Pending', conditions: [], containerStatuses: [] }
      } as any);
      vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue({
        items: [
          makeWarningEvent('my-pod', 'BackOff', 'Back-off restarting failed container'),
          makeWarningEvent('other-pod', 'FailedScheduling', 'Should not appear')
        ]
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'pod', name: 'my-pod', namespace: 'default' });

      expect(result).toContain('BackOff');
      expect(result).toContain('Back-off restarting failed container');
      expect(result).not.toContain('Should not appear');
    });

    it('shows a message when there are no warning events', async () => {
      vi.mocked(k8sCoreApi.readNamespacedPod).mockResolvedValue({
        status: { phase: 'Running', conditions: [], containerStatuses: [] }
      } as any);

      const result = await describeResourceTool.invoke({ kind: 'pod', name: 'healthy-pod', namespace: 'default' });

      expect(result).toContain('No recent warning events');
    });
  });

  describe('error handling', () => {
    it('returns a readable error message when the API call fails', async () => {
      const error = { body: JSON.stringify({ message: 'pod "gone-pod" not found' }) };
      vi.mocked(k8sCoreApi.readNamespacedPod).mockRejectedValue(error);

      const result = await describeResourceTool.invoke({ kind: 'pod', name: 'gone-pod', namespace: 'default' });

      expect(result).toContain('pod "gone-pod" not found');
      expect(result).not.toContain('{');
    });
  });
});
