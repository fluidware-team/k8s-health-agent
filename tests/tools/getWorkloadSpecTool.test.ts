import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/cluster/k8sClient', () => ({
  k8sAppsApi: {
    readNamespacedDeployment: vi.fn(),
    readNamespacedStatefulSet: vi.fn(),
    readNamespacedDaemonSet: vi.fn()
  }
}));

import { getWorkloadSpecTool } from '../../src/tools/investigationTools';
import { k8sAppsApi } from '../../src/cluster/k8sClient';

// A realistic container spec with all optional fields present
const fullContainer = {
  name: 'app',
  image: 'registry.example.com/app:v1.2.3',
  resources: {
    requests: { cpu: '100m', memory: '256Mi' },
    limits: { cpu: '500m', memory: '512Mi' }
  },
  env: [
    { name: 'DB_HOST', value: 'postgres' },
    { name: 'SECRET_KEY', valueFrom: { secretKeyRef: { name: 'app-secret', key: 'key' } } }
  ],
  ports: [{ containerPort: 8080, protocol: 'TCP' }],
  livenessProbe: { httpGet: { path: '/health', port: 8080 } },
  readinessProbe: { httpGet: { path: '/ready', port: 8080 } }
};

const minimalContainer = {
  name: 'sidecar',
  image: 'busybox:latest'
};

describe('getWorkloadSpecTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deployment', () => {
    it('returns replicas, strategy, and container details', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockResolvedValue({
        spec: {
          replicas: 3,
          strategy: { type: 'RollingUpdate' },
          template: { spec: { containers: [fullContainer], volumes: [] } }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'deployment', name: 'gateway', namespace: 'default' });

      expect(result).toContain('deployment/gateway');
      expect(result).toContain('Replicas: 3');
      expect(result).toContain('RollingUpdate');
      expect(result).toContain('registry.example.com/app:v1.2.3');
      expect(result).toContain('cpu: 100m');
      expect(result).toContain('memory: 512Mi');
    });

    it('shows env var names but never values', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockResolvedValue({
        spec: {
          replicas: 1,
          template: { spec: { containers: [fullContainer], volumes: [] } }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'deployment', name: 'app', namespace: 'default' });

      expect(result).toContain('DB_HOST');
      expect(result).toContain('SECRET_KEY');
      // Values must never appear
      expect(result).not.toContain('postgres');
      expect(result).not.toContain('app-secret');
    });

    it('shows ports and probes', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockResolvedValue({
        spec: {
          replicas: 1,
          template: { spec: { containers: [fullContainer], volumes: [] } }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'deployment', name: 'app', namespace: 'default' });

      expect(result).toContain('8080');
      expect(result).toContain('/health');
      expect(result).toContain('/ready');
    });

    it('shows volumes with their types and referenced names', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockResolvedValue({
        spec: {
          replicas: 1,
          template: {
            spec: {
              containers: [minimalContainer],
              volumes: [
                { name: 'config', configMap: { name: 'app-config' } },
                { name: 'tls', secret: { secretName: 'app-tls' } },
                { name: 'data', persistentVolumeClaim: { claimName: 'app-pvc' } },
                { name: 'tmp', emptyDir: {} }
              ]
            }
          }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'deployment', name: 'app', namespace: 'default' });

      expect(result).toContain('configMap');
      expect(result).toContain('app-config');
      expect(result).toContain('secret');
      expect(result).toContain('app-tls');
      expect(result).toContain('pvc');
      expect(result).toContain('app-pvc');
      expect(result).toContain('emptyDir');
    });

    it('handles containers with no optional fields', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockResolvedValue({
        spec: {
          replicas: 1,
          template: { spec: { containers: [minimalContainer], volumes: [] } }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'deployment', name: 'simple', namespace: 'default' });

      expect(result).toContain('sidecar');
      expect(result).toContain('busybox:latest');
    });
  });

  describe('statefulset', () => {
    it('returns replicas and container spec', async () => {
      vi.mocked(k8sAppsApi.readNamespacedStatefulSet).mockResolvedValue({
        spec: {
          replicas: 3,
          serviceName: 'rabbitmq',
          template: { spec: { containers: [minimalContainer], volumes: [] } }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'statefulset', name: 'rabbitmq', namespace: 'default' });

      expect(result).toContain('statefulset/rabbitmq');
      expect(result).toContain('Replicas: 3');
      expect(result).toContain('busybox:latest');
    });
  });

  describe('daemonset', () => {
    it('returns container spec (no replicas field)', async () => {
      vi.mocked(k8sAppsApi.readNamespacedDaemonSet).mockResolvedValue({
        spec: {
          template: { spec: { containers: [minimalContainer], volumes: [] } }
        }
      } as any);

      const result = await getWorkloadSpecTool.invoke({ kind: 'daemonset', name: 'fluentd', namespace: 'default' });

      expect(result).toContain('daemonset/fluentd');
      expect(result).toContain('busybox:latest');
      // DaemonSets don't have a replicas field
      expect(result).not.toContain('Replicas:');
    });
  });

  describe('error handling', () => {
    it('returns a readable error when the API call fails', async () => {
      const error = { body: JSON.stringify({ message: 'deployment "gone" not found' }) };
      vi.mocked(k8sAppsApi.readNamespacedDeployment).mockRejectedValue(error);

      const result = await getWorkloadSpecTool.invoke({ kind: 'deployment', name: 'gone', namespace: 'default' });

      expect(result).toContain('deployment "gone" not found');
      expect(result).not.toContain('{');
    });
  });
});
