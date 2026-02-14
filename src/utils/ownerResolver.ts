import { getLogger } from '@fluidware-it/saddlebag';
import { k8sAppsApi, k8sBatchApi } from '../cluster/k8sClient';
import type { OwnerReference } from '../types/k8s';

const logger = getLogger();

// Maps a resource key ("ReplicaSet/my-rs-abc123") to its resolved parent owner
export type OwnerMap = Map<string, OwnerReference>;

// Extract the first ownerReference from a K8s resource metadata
function getFirstOwner(metadata: any): OwnerReference | undefined {
  const refs = metadata?.ownerReferences;
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  return { kind: refs[0].kind, name: refs[0].name };
}

// Fetch ReplicaSets and Jobs in a namespace, build a map that resolves
// each intermediate owner (ReplicaSet → Deployment, Job → CronJob) to
// its parent workload.
export async function buildOwnerMap(namespace: string): Promise<OwnerMap> {
  const ownerMap: OwnerMap = new Map();

  const [replicaSets, jobs] = await Promise.all([fetchReplicaSetOwners(namespace), fetchJobOwners(namespace)]);

  // RS → Deployment
  for (const [rsName, parent] of replicaSets) {
    ownerMap.set(`ReplicaSet/${rsName}`, parent);
  }

  // Job → CronJob
  for (const [jobName, parent] of jobs) {
    ownerMap.set(`Job/${jobName}`, parent);
  }

  return ownerMap;
}

// Fetch ReplicaSets and return entries where a RS is owned by a Deployment
async function fetchReplicaSetOwners(namespace: string): Promise<[string, OwnerReference][]> {
  try {
    const res = await k8sAppsApi.listNamespacedReplicaSet({ namespace });
    const entries: [string, OwnerReference][] = [];

    for (const rs of res.items) {
      const parent = getFirstOwner(rs.metadata);
      if (parent && rs.metadata?.name) {
        entries.push([rs.metadata.name, parent]);
      }
    }

    return entries;
  } catch (error: any) {
    logger.warn(`Failed to fetch ReplicaSets for owner resolution: ${error?.message || String(error)}`);
    return [];
  }
}

// Fetch Jobs and return entries where a Job is owned by a CronJob
async function fetchJobOwners(namespace: string): Promise<[string, OwnerReference][]> {
  try {
    const res = await k8sBatchApi.listNamespacedJob({ namespace });
    const entries: [string, OwnerReference][] = [];

    for (const job of res.items) {
      const parent = getFirstOwner(job.metadata);
      if (parent && job.metadata?.name) {
        entries.push([job.metadata.name, parent]);
      }
    }

    return entries;
  } catch (error: any) {
    logger.warn(`Failed to fetch Jobs for owner resolution: ${error?.message || String(error)}`);
    return [];
  }
}

// Resolve a pod's ultimate owner workload.
// Walks up: Pod → ReplicaSet → Deployment, Pod → Job → CronJob, etc.
// Returns the highest-level owner found, or the direct owner if no parent exists.
export function resolveOwner(
  podOwnerRefs: OwnerReference[] | undefined,
  ownerMap: OwnerMap
): OwnerReference | undefined {
  if (!podOwnerRefs || podOwnerRefs.length === 0) return undefined;

  const directOwner = podOwnerRefs[0]!;
  const key = `${directOwner.kind}/${directOwner.name}`;

  // Check if the direct owner has a parent (e.g. RS → Deployment)
  const resolvedParent = ownerMap.get(key);
  return resolvedParent || directOwner;
}
