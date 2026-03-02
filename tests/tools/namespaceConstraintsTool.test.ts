import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    listNamespacedResourceQuota: vi.fn(),
    listNamespacedLimitRange: vi.fn()
  }
}));

import { listNamespaceConstraintsTool } from '../../src/tools/triageTools';
import { k8sCoreApi } from '../../src/cluster/k8sClient';

const mockQuotaResponse = {
  items: [
    {
      metadata: { name: 'compute-quota' },
      status: {
        hard: { 'requests.cpu': '4', 'requests.memory': '8Gi', 'limits.memory': '16Gi' },
        used: { 'requests.cpu': '3.8', 'requests.memory': '7.5Gi', 'limits.memory': '15Gi' }
      }
    }
  ]
};

const mockLimitRangeResponse = {
  items: [
    {
      metadata: { name: 'default-limits' },
      spec: {
        limits: [
          {
            type: 'Container',
            default: { cpu: '200m', memory: '256Mi' },
            max: { cpu: '2', memory: '2Gi' }
          }
        ]
      }
    }
  ]
};

describe('listNamespaceConstraintsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return resource quotas and limit ranges', async () => {
    vi.mocked(k8sCoreApi.listNamespacedResourceQuota).mockResolvedValue(mockQuotaResponse as any);
    vi.mocked(k8sCoreApi.listNamespacedLimitRange).mockResolvedValue(mockLimitRangeResponse as any);

    const result = JSON.parse(await listNamespaceConstraintsTool.invoke({ namespace: 'test-ns' }));

    expect(result.resourceQuotas).toHaveLength(1);
    expect(result.resourceQuotas[0].name).toBe('compute-quota');
    expect(result.resourceQuotas[0].hard['requests.cpu']).toBe('4');
    expect(result.resourceQuotas[0].used['requests.cpu']).toBe('3.8');
  });

  it('should return limit range definitions', async () => {
    vi.mocked(k8sCoreApi.listNamespacedResourceQuota).mockResolvedValue(mockQuotaResponse as any);
    vi.mocked(k8sCoreApi.listNamespacedLimitRange).mockResolvedValue(mockLimitRangeResponse as any);

    const result = JSON.parse(await listNamespaceConstraintsTool.invoke({ namespace: 'test-ns' }));

    expect(result.limitRanges).toHaveLength(1);
    expect(result.limitRanges[0].name).toBe('default-limits');
    expect(result.limitRanges[0].limits[0].type).toBe('Container');
    expect(result.limitRanges[0].limits[0].default.memory).toBe('256Mi');
  });

  it('should return empty arrays when no quotas or limits exist', async () => {
    vi.mocked(k8sCoreApi.listNamespacedResourceQuota).mockResolvedValue({ items: [] } as any);
    vi.mocked(k8sCoreApi.listNamespacedLimitRange).mockResolvedValue({ items: [] } as any);

    const result = JSON.parse(await listNamespaceConstraintsTool.invoke({ namespace: 'empty-ns' }));

    expect(result.resourceQuotas).toEqual([]);
    expect(result.limitRanges).toEqual([]);
  });

  it('should return an error string when the API call fails', async () => {
    vi.mocked(k8sCoreApi.listNamespacedResourceQuota).mockRejectedValue(new Error('RBAC denied'));
    vi.mocked(k8sCoreApi.listNamespacedLimitRange).mockResolvedValue({ items: [] } as any);

    const result = await listNamespaceConstraintsTool.invoke({ namespace: 'restricted-ns' });

    expect(typeof result).toBe('string');
    expect(result).toContain('Error');
  });
});
