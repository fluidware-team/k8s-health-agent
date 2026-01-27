import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the k8s client
vi.mock('../../src/cluster/k8sClient', () => ({
  k8sMetricsClient: {
    getPodMetrics: vi.fn(),
    getNodeMetrics: vi.fn(),
  },
}));

import { getPodMetricsTool, getNodeMetricsTool } from '../../src/tools/deepDiveTools';
import { k8sMetricsClient } from '../../src/cluster/k8sClient';

describe('metricsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPodMetricsTool', () => {
    it('should return pod metrics with CPU and memory usage', async () => {
      vi.mocked(k8sMetricsClient.getPodMetrics).mockResolvedValue({
        items: [
          {
            metadata: { name: 'my-pod', namespace: 'default' },
            containers: [
              {
                name: 'main',
                usage: {
                  cpu: '100m',
                  memory: '256Mi',
                },
              },
            ],
          },
        ],
      } as any);

      const result = await getPodMetricsTool.invoke({ namespace: 'default' });
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('my-pod');
      expect(parsed[0].containers[0].usage.cpu).toBe('100m');
      expect(parsed[0].containers[0].usage.memory).toBe('256Mi');
    });

    it('should filter by pod name when provided', async () => {
      vi.mocked(k8sMetricsClient.getPodMetrics).mockResolvedValue({
        items: [
          {
            metadata: { name: 'pod-1', namespace: 'default' },
            containers: [{ name: 'main', usage: { cpu: '50m', memory: '128Mi' } }],
          },
          {
            metadata: { name: 'pod-2', namespace: 'default' },
            containers: [{ name: 'main', usage: { cpu: '100m', memory: '256Mi' } }],
          },
        ],
      } as any);

      const result = await getPodMetricsTool.invoke({ namespace: 'default', podName: 'pod-1' });
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('pod-1');
    });

    it('should handle metrics server not available', async () => {
      vi.mocked(k8sMetricsClient.getPodMetrics).mockRejectedValue(
        new Error('metrics-server not available')
      );

      const result = await getPodMetricsTool.invoke({ namespace: 'default' });

      expect(result).toContain('Error');
      expect(result).toContain('metrics');
    });
  });

  describe('getNodeMetricsTool', () => {
    it('should return node metrics', async () => {
      vi.mocked(k8sMetricsClient.getNodeMetrics).mockResolvedValue({
        items: [
          {
            metadata: { name: 'node-1' },
            usage: {
              cpu: '2000m',
              memory: '8Gi',
            },
          },
        ],
      } as any);

      const result = await getNodeMetricsTool.invoke({});
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('node-1');
      expect(parsed[0].usage.cpu).toBe('2000m');
      expect(parsed[0].usage.memory).toBe('8Gi');
    });
  });
});
