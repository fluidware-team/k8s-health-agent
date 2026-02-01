import { describe, it, expect } from 'vitest';
import { filterPodData, filterNodeData, filterEventData } from '../../src/utils/k8sDataFilter';

describe('k8sDataFilter', () => {
  describe('filterPodData', () => {
    it('should extract essential pod information', () => {
      const rawPod = {
        metadata: {
          name: 'test-pod',
          namespace: 'default',
          uid: 'abc-123-xyz',
          resourceVersion: '123456',
          creationTimestamp: '2024-01-01T00:00:00Z',
          managedFields: [{ manager: 'kubectl', operation: 'Update' }],
          labels: { app: 'my-app', 'pod-template-hash': 'abc123' },
          annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '...' }
        },
        spec: {
          containers: [
            {
              name: 'main',
              image: 'nginx:latest',
              resources: {
                requests: { cpu: '100m', memory: '128Mi' },
                limits: { cpu: '500m', memory: '512Mi' }
              }
            }
          ],
          nodeName: 'node-1'
        },
        status: {
          phase: 'Running',
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Initialized', status: 'True' }
          ],
          containerStatuses: [
            {
              name: 'main',
              ready: true,
              restartCount: 5,
              state: { running: { startedAt: '2024-01-01T00:00:00Z' } }
            }
          ]
        }
      };

      const filtered = filterPodData(rawPod);

      // Should keep essential info
      expect(filtered.name).toBe('test-pod');
      expect(filtered.namespace).toBe('default');
      expect(filtered.status).toBe('Running');
      expect(filtered.nodeName).toBe('node-1');
      expect(filtered.restarts).toBe(5);
      expect(filtered.containers).toHaveLength(1);
      expect(filtered.containers[0]!.name).toBe('main');
      expect(filtered.containers[0]!.image).toBe('nginx:latest');
      expect(filtered.containers[0]!.ready).toBe(true);

      // Should not include unnecessary metadata (using 'any' cast to test that these don't exist)
      expect((filtered as any).uid).toBeUndefined();
      expect((filtered as any).resourceVersion).toBeUndefined();
      expect((filtered as any).managedFields).toBeUndefined();
    });

    it('should handle pod with waiting state (CrashLoopBackOff)', () => {
      const crashingPod = {
        metadata: { name: 'crash-pod', namespace: 'default' },
        spec: {
          containers: [{ name: 'main', image: 'broken:v1' }],
          nodeName: 'node-1'
        },
        status: {
          phase: 'Running',
          containerStatuses: [
            {
              name: 'main',
              ready: false,
              restartCount: 10,
              state: {
                waiting: {
                  reason: 'CrashLoopBackOff',
                  message: 'back-off 5m0s restarting failed container'
                }
              }
            }
          ]
        }
      };

      const filtered = filterPodData(crashingPod);

      expect(filtered.restarts).toBe(10);
      expect(filtered.containers[0]!.state).toBe('CrashLoopBackOff');
      expect(filtered.containers[0]!.stateMessage).toBe('back-off 5m0s restarting failed container');
    });

    it('should handle pod in Pending state with unschedulable reason', () => {
      const pendingPod = {
        metadata: { name: 'pending-pod', namespace: 'default' },
        spec: {
          containers: [{ name: 'main', image: 'nginx:latest' }]
        },
        status: {
          phase: 'Pending',
          conditions: [
            {
              type: 'PodScheduled',
              status: 'False',
              reason: 'Unschedulable',
              message: 'Insufficient cpu'
            }
          ]
        }
      };

      const filtered = filterPodData(pendingPod);

      expect(filtered.status).toBe('Pending');
      expect(filtered.conditions).toContainEqual({
        type: 'PodScheduled',
        status: 'False',
        reason: 'Unschedulable',
        message: 'Insufficient cpu'
      });
    });

    it('should keep resource requests and limits', () => {
      const podWithResources = {
        metadata: { name: 'resource-pod', namespace: 'default' },
        spec: {
          containers: [
            {
              name: 'main',
              image: 'nginx',
              resources: {
                requests: { cpu: '100m', memory: '128Mi' },
                limits: { cpu: '500m', memory: '512Mi' }
              }
            }
          ]
        },
        status: { phase: 'Running' }
      };

      const filtered = filterPodData(podWithResources);

      expect(filtered.containers[0]!.resources).toEqual({
        requests: { cpu: '100m', memory: '128Mi' },
        limits: { cpu: '500m', memory: '512Mi' }
      });
    });
  });

  describe('filterNodeData', () => {
    it('should extract essential node information', () => {
      const rawNode = {
        metadata: {
          name: 'node-1',
          uid: 'node-uid-123',
          resourceVersion: '789',
          managedFields: [{ manager: 'kubelet' }],
          labels: {
            'kubernetes.io/os': 'linux',
            'node.kubernetes.io/instance-type': 'm5.large'
          }
        },
        spec: {
          podCIDR: '10.244.0.0/24',
          taints: [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }]
        },
        status: {
          capacity: { cpu: '4', memory: '16Gi', pods: '110' },
          allocatable: { cpu: '3800m', memory: '15Gi', pods: '100' },
          conditions: [
            { type: 'Ready', status: 'True', message: 'kubelet is ready' },
            { type: 'MemoryPressure', status: 'False', message: 'no memory pressure' },
            { type: 'DiskPressure', status: 'False', message: 'no disk pressure' }
          ]
        }
      };

      const filtered = filterNodeData(rawNode);

      expect(filtered.name).toBe('node-1');
      expect(filtered.capacity).toEqual({ cpu: '4', memory: '16Gi', pods: '110' });
      expect(filtered.allocatable).toEqual({ cpu: '3800m', memory: '15Gi', pods: '100' });
      expect(filtered.conditions).toHaveLength(3);
      expect(filtered.taints).toEqual([{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }]);

      // Should not include unnecessary metadata (using 'any' cast to test that these don't exist)
      expect((filtered as any).uid).toBeUndefined();
      expect((filtered as any).resourceVersion).toBeUndefined();
      expect((filtered as any).managedFields).toBeUndefined();
    });

    it('should return only unhealthy conditions when requested', () => {
      const nodeWithIssues = {
        metadata: { name: 'unhealthy-node' },
        status: {
          conditions: [
            { type: 'Ready', status: 'False', reason: 'KubeletNotReady' },
            { type: 'MemoryPressure', status: 'True', message: 'high memory usage' },
            { type: 'DiskPressure', status: 'False' }
          ]
        }
      };

      const filtered = filterNodeData(nodeWithIssues, { onlyUnhealthy: true });

      expect(filtered.conditions).toHaveLength(2);
      expect(filtered.conditions.map((c: any) => c.type)).toContain('Ready');
      expect(filtered.conditions.map((c: any) => c.type)).toContain('MemoryPressure');
    });
  });

  describe('filterEventData', () => {
    it('should extract essential event information', () => {
      const rawEvent = {
        metadata: {
          name: 'event-123',
          namespace: 'default',
          uid: 'event-uid',
          resourceVersion: '999',
          managedFields: []
        },
        involvedObject: {
          kind: 'Pod',
          name: 'my-pod',
          namespace: 'default'
        },
        reason: 'OOMKilled',
        message: 'Container killed due to OOM',
        type: 'Warning',
        count: 5,
        firstTimestamp: '2024-01-01T00:00:00Z',
        lastTimestamp: '2024-01-01T01:00:00Z'
      };

      const filtered = filterEventData(rawEvent)!;

      expect(filtered.reason).toBe('OOMKilled');
      expect(filtered.message).toBe('Container killed due to OOM');
      expect(filtered.type).toBe('Warning');
      expect(filtered.count).toBe(5);
      expect(filtered.involvedObject).toEqual({
        kind: 'Pod',
        name: 'my-pod',
        namespace: 'default'
      });

      // Should not include unnecessary metadata (using 'any' cast to test that these don't exist)
      expect((filtered as any).uid).toBeUndefined();
      expect((filtered as any).resourceVersion).toBeUndefined();
      expect((filtered as any).managedFields).toBeUndefined();
    });

    it('should filter for specific warning events', () => {
      const events = [
        { reason: 'Scheduled', type: 'Normal', message: 'Pod scheduled' },
        { reason: 'OOMKilled', type: 'Warning', message: 'OOM killed' },
        { reason: 'FailedMount', type: 'Warning', message: 'Mount failed' },
        { reason: 'Pulled', type: 'Normal', message: 'Image pulled' },
        { reason: 'BackOff', type: 'Warning', message: 'Back-off restarting' }
      ].map((e, i) => ({
        metadata: { name: `event-${i}` },
        involvedObject: { kind: 'Pod', name: 'test' },
        ...e
      }));

      const filtered = events
        .filter(e => filterEventData(e, { onlyWarnings: true }) !== null)
        .map(e => filterEventData(e)!);

      expect(filtered).toHaveLength(3);
      expect(filtered.map(e => e.reason)).toEqual(['OOMKilled', 'FailedMount', 'BackOff']);
    });
  });
});
