import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the k8sClient module
vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    listNamespacedEvent: vi.fn(),
  },
}));

import { listEventsTool } from '../../src/tools/k8sTools';
import { k8sCoreApi } from '../../src/cluster/k8sClient';

describe('listEventsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should filter and return warning events', async () => {
    const mockEvents = {
      items: [
        {
          metadata: { name: 'event-1', namespace: 'default' },
          involvedObject: { kind: 'Pod', name: 'my-pod', namespace: 'default' },
          reason: 'OOMKilled',
          message: 'Container killed due to OOM',
          type: 'Warning',
          count: 3,
          lastTimestamp: '2024-01-01T00:00:00Z',
        },
        {
          metadata: { name: 'event-2', namespace: 'default' },
          involvedObject: { kind: 'Pod', name: 'my-pod', namespace: 'default' },
          reason: 'Pulled',
          message: 'Image pulled successfully',
          type: 'Normal',
          count: 1,
        },
        {
          metadata: { name: 'event-3', namespace: 'default' },
          involvedObject: { kind: 'Pod', name: 'another-pod', namespace: 'default' },
          reason: 'FailedMount',
          message: 'MountVolume.SetUp failed for volume "secret-vol"',
          type: 'Warning',
          count: 5,
        },
      ],
    };

    vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue(mockEvents as any);

    const result = await listEventsTool.invoke({ namespace: 'default' });
    const parsed = JSON.parse(result);

    // Should only return Warning events by default
    expect(parsed).toHaveLength(2);
    expect(parsed[0].reason).toBe('OOMKilled');
    expect(parsed[1].reason).toBe('FailedMount');
  });

  it('should return all events when includeNormal is true', async () => {
    const mockEvents = {
      items: [
        {
          metadata: { name: 'event-1' },
          involvedObject: { kind: 'Pod', name: 'my-pod' },
          reason: 'OOMKilled',
          message: 'OOM killed',
          type: 'Warning',
        },
        {
          metadata: { name: 'event-2' },
          involvedObject: { kind: 'Pod', name: 'my-pod' },
          reason: 'Pulled',
          message: 'Image pulled',
          type: 'Normal',
        },
      ],
    };

    vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue(mockEvents as any);

    const result = await listEventsTool.invoke({ namespace: 'default', includeNormal: true });
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(2);
  });

  it('should filter events by object name', async () => {
    const mockEvents = {
      items: [
        {
          metadata: { name: 'event-1' },
          involvedObject: { kind: 'Pod', name: 'target-pod' },
          reason: 'BackOff',
          message: 'Back-off restarting',
          type: 'Warning',
        },
        {
          metadata: { name: 'event-2' },
          involvedObject: { kind: 'Pod', name: 'other-pod' },
          reason: 'FailedMount',
          message: 'Mount failed',
          type: 'Warning',
        },
      ],
    };

    vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue(mockEvents as any);

    const result = await listEventsTool.invoke({ namespace: 'default', objectName: 'target-pod' });
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].involvedObject.name).toBe('target-pod');
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(k8sCoreApi.listNamespacedEvent).mockRejectedValue(new Error('API error'));

    const result = await listEventsTool.invoke({ namespace: 'default' });

    expect(result).toContain('Error retrieving events');
  });

  it('should include critical event reasons like OOMKilled, FailedMount, BackOff', async () => {
    const mockEvents = {
      items: [
        {
          metadata: { name: 'event-1' },
          involvedObject: { kind: 'Pod', name: 'pod-1' },
          reason: 'OOMKilled',
          message: 'Container killed',
          type: 'Warning',
        },
        {
          metadata: { name: 'event-2' },
          involvedObject: { kind: 'Pod', name: 'pod-2' },
          reason: 'FailedMount',
          message: 'Secret not found',
          type: 'Warning',
        },
        {
          metadata: { name: 'event-3' },
          involvedObject: { kind: 'Pod', name: 'pod-3' },
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          type: 'Warning',
        },
        {
          metadata: { name: 'event-4' },
          involvedObject: { kind: 'Pod', name: 'pod-4' },
          reason: 'FailedScheduling',
          message: 'Insufficient cpu',
          type: 'Warning',
        },
      ],
    };

    vi.mocked(k8sCoreApi.listNamespacedEvent).mockResolvedValue(mockEvents as any);

    const result = await listEventsTool.invoke({ namespace: 'default' });
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(4);
    const reasons = parsed.map((e: any) => e.reason);
    expect(reasons).toContain('OOMKilled');
    expect(reasons).toContain('FailedMount');
    expect(reasons).toContain('BackOff');
    expect(reasons).toContain('FailedScheduling');
  });
});
