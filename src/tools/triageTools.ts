import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { k8sCoreApi } from '../cluster/k8sClient';
import { filterPodData, filterNodeData, filterEventData } from '../utils/k8sDataFilter';

// Triage tools are "cheap" - they retrieve list data without heavy processing

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

// Export all triage tools as an array for easy use
export const triageTools = [listPodsTool, listNodesTool, listEventsTool];
