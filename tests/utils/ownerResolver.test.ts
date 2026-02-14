import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOwner } from '../../src/utils/ownerResolver';
import type { OwnerMap } from '../../src/utils/ownerResolver';
import type { OwnerReference } from '../../src/types/k8s';

// Mock the K8s clients — they're imported at module level in ownerResolver
vi.mock('../../src/cluster/k8sClient', () => ({
  k8sAppsApi: {
    listNamespacedReplicaSet: vi.fn()
  },
  k8sBatchApi: {
    listNamespacedJob: vi.fn()
  }
}));

describe('ownerResolver', () => {
  describe('resolveOwner', () => {
    let ownerMap: OwnerMap;

    beforeEach(() => {
      ownerMap = new Map();
    });

    it('should return undefined when pod has no ownerReferences', () => {
      expect(resolveOwner(undefined, ownerMap)).toBeUndefined();
      expect(resolveOwner([], ownerMap)).toBeUndefined();
    });

    it('should return the direct owner when no parent mapping exists', () => {
      const refs: OwnerReference[] = [{ kind: 'StatefulSet', name: 'my-sts' }];
      const result = resolveOwner(refs, ownerMap);

      expect(result).toEqual({ kind: 'StatefulSet', name: 'my-sts' });
    });

    it('should resolve ReplicaSet to its parent Deployment', () => {
      ownerMap.set('ReplicaSet/my-deploy-abc123', { kind: 'Deployment', name: 'my-deploy' });

      const refs: OwnerReference[] = [{ kind: 'ReplicaSet', name: 'my-deploy-abc123' }];
      const result = resolveOwner(refs, ownerMap);

      expect(result).toEqual({ kind: 'Deployment', name: 'my-deploy' });
    });

    it('should resolve Job to its parent CronJob', () => {
      ownerMap.set('Job/my-cronjob-12345', { kind: 'CronJob', name: 'my-cronjob' });

      const refs: OwnerReference[] = [{ kind: 'Job', name: 'my-cronjob-12345' }];
      const result = resolveOwner(refs, ownerMap);

      expect(result).toEqual({ kind: 'CronJob', name: 'my-cronjob' });
    });

    it('should return ReplicaSet as owner when RS has no parent', () => {
      // RS exists in the map but with no parent → won't be in ownerMap
      const refs: OwnerReference[] = [{ kind: 'ReplicaSet', name: 'orphan-rs-abc' }];
      const result = resolveOwner(refs, ownerMap);

      expect(result).toEqual({ kind: 'ReplicaSet', name: 'orphan-rs-abc' });
    });

    it('should use the first ownerReference when multiple exist', () => {
      ownerMap.set('ReplicaSet/deploy-a-123', { kind: 'Deployment', name: 'deploy-a' });

      const refs: OwnerReference[] = [
        { kind: 'ReplicaSet', name: 'deploy-a-123' },
        { kind: 'ReplicaSet', name: 'deploy-b-456' }
      ];
      const result = resolveOwner(refs, ownerMap);

      expect(result).toEqual({ kind: 'Deployment', name: 'deploy-a' });
    });
  });

  describe('buildOwnerMap', () => {
    it('should build map from ReplicaSets and Jobs', async () => {
      const { k8sAppsApi, k8sBatchApi } = await import('../../src/cluster/k8sClient');

      vi.mocked(k8sAppsApi.listNamespacedReplicaSet).mockResolvedValue({
        items: [
          {
            metadata: {
              name: 'web-deploy-abc123',
              ownerReferences: [{ kind: 'Deployment', name: 'web-deploy' }]
            }
          },
          {
            metadata: {
              name: 'orphan-rs',
              ownerReferences: [{ kind: 'SomeOther', name: 'other' }]
            }
          }
        ]
      } as any);

      vi.mocked(k8sBatchApi.listNamespacedJob).mockResolvedValue({
        items: [
          {
            metadata: {
              name: 'cleanup-job-29515560',
              ownerReferences: [{ kind: 'CronJob', name: 'cleanup-job' }]
            }
          }
        ]
      } as any);

      const { buildOwnerMap } = await import('../../src/utils/ownerResolver');
      const map = await buildOwnerMap('test-ns');

      expect(map.get('ReplicaSet/web-deploy-abc123')).toEqual({ kind: 'Deployment', name: 'web-deploy' });
      expect(map.get('ReplicaSet/orphan-rs')).toEqual({ kind: 'SomeOther', name: 'other' });
      expect(map.get('Job/cleanup-job-29515560')).toEqual({ kind: 'CronJob', name: 'cleanup-job' });
    });

    it('should return empty map when API calls fail', async () => {
      const { k8sAppsApi, k8sBatchApi } = await import('../../src/cluster/k8sClient');

      vi.mocked(k8sAppsApi.listNamespacedReplicaSet).mockRejectedValue(new Error('forbidden'));
      vi.mocked(k8sBatchApi.listNamespacedJob).mockRejectedValue(new Error('forbidden'));

      const { buildOwnerMap } = await import('../../src/utils/ownerResolver');
      const map = await buildOwnerMap('test-ns');

      expect(map.size).toBe(0);
    });
  });
});
