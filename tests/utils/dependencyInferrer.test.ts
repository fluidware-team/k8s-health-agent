import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    listNamespacedService: vi.fn(),
    listNamespacedEndpoints: vi.fn()
  }
}));

import { inferDependencies } from '../../src/utils/dependencyInferrer';
import { k8sCoreApi } from '../../src/cluster/k8sClient';

function makeService(name: string, selector: Record<string, string>) {
  return { metadata: { name }, spec: { selector } };
}

function makeEndpoints(name: string, readyAddresses: number) {
  return {
    metadata: { name },
    subsets: readyAddresses > 0 ? [{ addresses: Array(readyAddresses).fill({ ip: '10.0.0.1' }) }] : []
  };
}

describe('inferDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should flag workloads whose service has 0 ready endpoints', async () => {
    vi.mocked(k8sCoreApi.listNamespacedService).mockResolvedValue({
      items: [makeService('rabbitmq', { app: 'rabbitmq' })]
    } as any);
    vi.mocked(k8sCoreApi.listNamespacedEndpoints).mockResolvedValue({
      items: [makeEndpoints('rabbitmq', 0)]
    } as any);

    const hints = await inferDependencies('ns', [{ name: 'rabbitmq-0', labels: { app: 'rabbitmq' } }]);

    expect(hints).toHaveLength(1);
    expect(hints[0]!.workload).toContain('rabbitmq');
    expect(hints[0]!.hint).toContain('0 ready endpoints');
  });

  it('should not flag workloads with ready endpoints', async () => {
    vi.mocked(k8sCoreApi.listNamespacedService).mockResolvedValue({
      items: [makeService('api', { app: 'api' })]
    } as any);
    vi.mocked(k8sCoreApi.listNamespacedEndpoints).mockResolvedValue({
      items: [makeEndpoints('api', 2)]
    } as any);

    const hints = await inferDependencies('ns', [{ name: 'api-pod', labels: { app: 'api' } }]);

    expect(hints).toHaveLength(0);
  });

  it('should return empty array when no services exist', async () => {
    vi.mocked(k8sCoreApi.listNamespacedService).mockResolvedValue({ items: [] } as any);
    vi.mocked(k8sCoreApi.listNamespacedEndpoints).mockResolvedValue({ items: [] } as any);

    const hints = await inferDependencies('ns', [{ name: 'pod', labels: {} }]);

    expect(hints).toHaveLength(0);
  });

  it('should return empty array on API failure', async () => {
    vi.mocked(k8sCoreApi.listNamespacedService).mockRejectedValue(new Error('RBAC denied'));

    const hints = await inferDependencies('ns', [{ name: 'pod', labels: {} }]);

    expect(hints).toHaveLength(0);
  });

  it('should not flag a service when selector does not match any failing pod', async () => {
    vi.mocked(k8sCoreApi.listNamespacedService).mockResolvedValue({
      items: [makeService('cache', { app: 'cache' })]
    } as any);
    vi.mocked(k8sCoreApi.listNamespacedEndpoints).mockResolvedValue({
      items: [makeEndpoints('cache', 0)]
    } as any);

    // failing pod has label app=api — doesn't match service selector app=cache
    const hints = await inferDependencies('ns', [{ name: 'api-pod', labels: { app: 'api' } }]);

    expect(hints).toHaveLength(0);
  });
});
