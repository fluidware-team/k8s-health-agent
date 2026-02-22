import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/cluster/k8sClient', () => ({
  k8sCoreApi: {
    listNamespacedConfigMap: vi.fn(),
    listNamespacedSecret: vi.fn()
  }
}));

import { listConfigsAndSecretsTool } from '../../src/tools/investigationTools';
import { k8sCoreApi } from '../../src/cluster/k8sClient';

const makeConfigMap = (name: string, creationTimestamp = '2024-01-01T00:00:00Z') => ({
  metadata: { name, creationTimestamp }
});

const makeSecret = (name: string, type = 'Opaque', creationTimestamp = '2024-01-01T00:00:00Z') => ({
  metadata: { name, creationTimestamp },
  type,
  // data field present on real secrets — must never appear in output
  data: { password: 'c2VjcmV0MTIz', apiKey: 'c2VjcmV0a2V5' }
});

describe('listConfigsAndSecretsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns configmap and secret names with timestamps', async () => {
    vi.mocked(k8sCoreApi.listNamespacedConfigMap).mockResolvedValue({
      items: [makeConfigMap('app-config'), makeConfigMap('db-config')]
    } as any);
    vi.mocked(k8sCoreApi.listNamespacedSecret).mockResolvedValue({
      items: [makeSecret('app-secret'), makeSecret('db-credentials')]
    } as any);

    const result = await listConfigsAndSecretsTool.invoke({ namespace: 'default' });

    expect(result).toContain('app-config');
    expect(result).toContain('db-config');
    expect(result).toContain('app-secret');
    expect(result).toContain('db-credentials');
    expect(result).toContain('2024-01-01');
  });

  it('never includes secret data values', async () => {
    vi.mocked(k8sCoreApi.listNamespacedConfigMap).mockResolvedValue({ items: [] } as any);
    vi.mocked(k8sCoreApi.listNamespacedSecret).mockResolvedValue({
      items: [makeSecret('my-secret')]
    } as any);

    const result = await listConfigsAndSecretsTool.invoke({ namespace: 'default' });

    // Base64-encoded secret values must never appear
    expect(result).not.toContain('c2VjcmV0');
    expect(result).not.toContain('c2VjcmV0a2V5');
    // 'data' key itself should not appear
    expect(result).not.toContain('"data"');
  });

  it('shows the secret type', async () => {
    vi.mocked(k8sCoreApi.listNamespacedConfigMap).mockResolvedValue({ items: [] } as any);
    vi.mocked(k8sCoreApi.listNamespacedSecret).mockResolvedValue({
      items: [
        makeSecret('tls-cert', 'kubernetes.io/tls'),
        makeSecret('sa-token', 'kubernetes.io/service-account-token')
      ]
    } as any);

    const result = await listConfigsAndSecretsTool.invoke({ namespace: 'default' });

    expect(result).toContain('kubernetes.io/tls');
    expect(result).toContain('kubernetes.io/service-account-token');
  });

  it('filters by name prefix when provided', async () => {
    vi.mocked(k8sCoreApi.listNamespacedConfigMap).mockResolvedValue({
      items: [makeConfigMap('app-config'), makeConfigMap('db-config'), makeConfigMap('app-settings')]
    } as any);
    vi.mocked(k8sCoreApi.listNamespacedSecret).mockResolvedValue({
      items: [makeSecret('app-secret'), makeSecret('db-credentials')]
    } as any);

    const result = await listConfigsAndSecretsTool.invoke({ namespace: 'default', namePrefix: 'app' });

    expect(result).toContain('app-config');
    expect(result).toContain('app-settings');
    expect(result).toContain('app-secret');
    // db-* entries must be excluded
    expect(result).not.toContain('db-config');
    expect(result).not.toContain('db-credentials');
  });

  it('shows a message when no resources match', async () => {
    vi.mocked(k8sCoreApi.listNamespacedConfigMap).mockResolvedValue({ items: [] } as any);
    vi.mocked(k8sCoreApi.listNamespacedSecret).mockResolvedValue({ items: [] } as any);

    const result = await listConfigsAndSecretsTool.invoke({ namespace: 'default' });

    expect(result).toContain('No ConfigMaps');
    expect(result).toContain('No Secrets');
  });

  it('returns a readable error when the API call fails', async () => {
    const error = { body: JSON.stringify({ message: 'namespace "gone" not found' }) };
    vi.mocked(k8sCoreApi.listNamespacedConfigMap).mockRejectedValue(error);
    vi.mocked(k8sCoreApi.listNamespacedSecret).mockRejectedValue(error);

    const result = await listConfigsAndSecretsTool.invoke({ namespace: 'gone' });

    expect(result).toContain('namespace "gone" not found');
    expect(result).not.toContain('{');
  });
});
