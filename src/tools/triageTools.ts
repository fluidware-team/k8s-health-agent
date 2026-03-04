import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getLogger } from '@fluidware-it/saddlebag';
import { k8sCoreApi } from '../cluster/k8sClient';
import { filterPodData, filterNodeData, filterEventData } from '../utils/k8sDataFilter';
import { extractK8sErrorMessage } from '../utils/k8sErrorUtils';
import type { NamespaceConstraints } from '../types/triage';

// Triage tools are "cheap" - they retrieve list data without heavy processing

// Tool to list pods in a namespace
export const listPodsTool = tool(
  async ({ namespace }) => {
    try {
      const res = await k8sCoreApi.listNamespacedPod({ namespace });
      return JSON.stringify(res.items.map(filterPodData));
    } catch (e) {
      return `Error retrieving pods: ${extractK8sErrorMessage(e, 'list_pods')}`;
    }
  },
  {
    name: 'list_pods',
    description: 'Lists pods in a specific namespace to check their status and restarts.',
    schema: z.object({
      namespace: z.string().describe('The kubernetes namespace to analyze')
    })
  }
);

// Tool to check nodes (for general issues)
export const listNodesTool = tool(
  async () => {
    try {
      const res = await k8sCoreApi.listNode();
      return JSON.stringify(res.items.map(n => filterNodeData(n)));
    } catch (e) {
      return `Error retrieving nodes: ${extractK8sErrorMessage(e, 'list_nodes')}`;
    }
  },
  {
    name: 'list_nodes',
    description: 'Checks the cluster node status for general infrastructure issues.',
    schema: z.object({})
  }
);

// Tool to list events in a namespace
export const listEventsTool = tool(
  async ({ namespace, objectName, includeNormal = false }) => {
    getLogger().info(`[tool] list_events in ${namespace}${objectName ? ` (object: ${objectName})` : ''}`);
    try {
      const res = await k8sCoreApi.listNamespacedEvent({ namespace });
      let events = res.items;

      // Filter by object name if provided
      if (objectName) {
        events = events.filter(e => e.involvedObject?.name === objectName);
      }

      // Filter and transform events
      const filtered = events
        .map(e => filterEventData(e, { onlyWarnings: !includeNormal }))
        .filter((e): e is NonNullable<typeof e> => e !== null);

      return JSON.stringify(filtered);
    } catch (e) {
      return `Error retrieving events: ${extractK8sErrorMessage(e, 'list_events')}`;
    }
  },
  {
    name: 'list_events',
    description:
      'Lists Kubernetes events in a namespace. Useful for detecting OOMKilled, FailedMount, FailedScheduling, BackOff and other warning events.',
    schema: z.object({
      namespace: z.string().describe('The kubernetes namespace to analyze'),
      objectName: z.string().optional().describe('Filter events by the name of the involved object (e.g., pod name)'),
      includeNormal: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, includes Normal events (not just Warnings)')
    })
  }
);

// Tool to fetch ResourceQuota and LimitRange objects for a namespace.
// Useful for diagnosing Pending pods (quota exhausted) and OOMKilled
// (LimitRange defaults silently capping container memory).
export const listNamespaceConstraintsTool = tool(
  async ({ namespace }) => {
    try {
      const [quotaRes, limitRes] = await Promise.all([
        k8sCoreApi.listNamespacedResourceQuota({ namespace }),
        k8sCoreApi.listNamespacedLimitRange({ namespace })
      ]);

      const resourceQuotas = (quotaRes.items ?? []).map((rq: any) => ({
        name: rq.metadata?.name ?? '',
        hard: rq.status?.hard ?? {},
        used: rq.status?.used ?? {}
      }));

      const limitRanges = (limitRes.items ?? []).map((lr: any) => ({
        name: lr.metadata?.name ?? '',
        limits: (lr.spec?.limits ?? []).map((l: any) => ({
          type: l.type,
          ...(l.default && { default: l.default }),
          ...(l.max && { max: l.max })
        }))
      }));

      const result: NamespaceConstraints = { resourceQuotas, limitRanges };
      return JSON.stringify(result);
    } catch (e) {
      return `Error retrieving namespace constraints: ${extractK8sErrorMessage(e, 'list_namespace_constraints')}`;
    }
  },
  {
    name: 'list_namespace_constraints',
    description:
      'Lists ResourceQuota and LimitRange objects for a namespace. Useful for diagnosing Pending pods (quota exhausted) and OOMKilled pods (LimitRange default silently capping container memory).',
    schema: z.object({
      namespace: z.string().describe('The namespace to inspect')
    })
  }
);
