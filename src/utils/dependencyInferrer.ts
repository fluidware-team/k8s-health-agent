import { k8sCoreApi } from '../cluster/k8sClient';
import { getLogger } from '@fluidware-it/saddlebag';
import type { DependencyHint } from '../types/triage';

export type { DependencyHint };

export interface FailingPodInfo {
  name: string;
  labels: Record<string, string>;
}

/**
 * Returns true when all key-value pairs in `selector` exist in `labels`.
 */
function selectorMatches(selector: Record<string, string>, labels: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

/**
 * Count ready endpoint addresses across all subsets of an Endpoints object.
 */
function countReadyAddresses(endpoints: any): number {
  const subsets: any[] = endpoints.subsets ?? [];
  return subsets.reduce((sum, s) => sum + (s.addresses?.length ?? 0), 0);
}

/**
 * Infer service dependency hints for failing pods by cross-referencing:
 * - Services whose label selector matches a failing pod's labels
 * - Whether those services have 0 ready endpoints
 *
 * A hint is emitted for each such service, indicating the workload it fronts
 * has no healthy backends — which may explain cascading failures in other workloads.
 *
 * Does not fetch workload specs or parse env vars; label matching only.
 * Returns [] on any API error (non-fatal: RBAC may restrict Service access).
 */
export async function inferDependencies(namespace: string, failingPods: FailingPodInfo[]): Promise<DependencyHint[]> {
  try {
    const [serviceRes, endpointsRes] = await Promise.all([
      k8sCoreApi.listNamespacedService({ namespace }),
      k8sCoreApi.listNamespacedEndpoints({ namespace })
    ]);

    const services = serviceRes.items ?? [];
    const endpointsMap = new Map<string, number>(
      (endpointsRes.items ?? []).map((ep: any) => [ep.metadata?.name, countReadyAddresses(ep)])
    );

    const hints: DependencyHint[] = [];

    for (const svc of services) {
      const selector: Record<string, string> = svc.spec?.selector ?? {};
      if (Object.keys(selector).length === 0) continue; // headless / selector-less services

      const svcName = svc.metadata?.name ?? '';
      const readyCount = endpointsMap.get(svcName) ?? 0;
      if (readyCount > 0) continue; // service is healthy

      // Check if any failing pod matches this service's selector
      const matchingPod = failingPods.find(p => selectorMatches(selector, p.labels));
      if (!matchingPod) continue;

      hints.push({
        workload: `Service/${svcName} (pod: ${matchingPod.name})`,
        hint: `Service/${svcName} has 0 ready endpoints — its backing pods are failing. Other workloads relying on this service may be affected downstream.`
      });
    }

    return hints;
  } catch (e: any) {
    getLogger().warn(`Could not infer service dependencies: ${e?.message ?? e}`);
    return [];
  }
}
