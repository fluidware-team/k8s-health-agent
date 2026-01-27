import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { k8sCoreApi } from '../cluster/k8sClient';
import { getLogger } from '@fluidware-it/saddlebag';
import { filterPodData, filterNodeData, filterEventData } from '../utils/k8sDataFilter';

// Tool to list pods in a namespace
export const listPodsTool = tool(
  async ({ namespace }) => {
    try {
      const res = await k8sCoreApi.listNamespacedPod({ namespace });
      return JSON.stringify(res.items.map(filterPodData));
    } catch (e) {
      return `Error retrieving pods: ${JSON.stringify(e)}`;
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
      return `Error retrieving nodes: ${JSON.stringify(e)}`;
    }
  },
  {
    name: 'list_nodes',
    description: 'Checks the cluster node status for general infrastructure issues.',
    schema: z.object({})
  }
);

// Tool to read logs from a specific pod
export const readPodLogsTool = tool(
  async ({ podName, namespace, containerName, previous, tailLines = 100 }) => {
    try {
      getLogger().info(`Reading pod ${namespace}:${podName} logs (container: ${containerName}, previous: ${previous})`);
      return await k8sCoreApi.readNamespacedPodLog({
        name: podName,
        namespace,
        container: containerName,
        tailLines,
        previous
      });
    } catch (e: any) {
      // Specific error handling: if we request previous logs but they don't exist
      if (e.response?.statusCode === 404 || e.response?.body?.message?.includes('previous terminated container')) {
        return `No previous logs found for pod ${podName}. Try reading current logs.`;
      }
      getLogger().error(`Error reading pod ${namespace}:${podName} logs`);
      return `Error while reading pod ${podName} logs: ${JSON.stringify(e)}`;
    }
  },
  {
    name: 'read_pod_logs',
    description:
      "Reads pod logs. Set 'previous' to true if the pod has crashed (CrashLoopBackOff) to see the error that caused the restart.",
    schema: z.object({
      podName: z.string().describe('The name of the pod'),
      namespace: z.string().describe('The namespace of the pod'),
      containerName: z.string().describe('The name of the container (optional if there is only one)'),
      previous: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, reads logs from the previous instance (useful for crashes)'),
      tailLines: z.number().optional().default(100).describe('Number of final lines to read (default 100)')
    })
  }
);

// Tool to list events in a namespace
export const listEventsTool = tool(
  async ({ namespace, objectName, includeNormal = false }) => {
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
      return `Error retrieving events: ${JSON.stringify(e)}`;
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
