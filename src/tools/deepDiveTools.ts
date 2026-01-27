import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { k8sCoreApi, k8sMetricsClient } from '../cluster/k8sClient';
import { getLogger } from '@fluidware-it/saddlebag';

// Deep dive tools are "expensive" - they retrieve detailed data for specific resources

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

// Tool to get pod metrics from metrics-server
export const getPodMetricsTool = tool(
  async ({ namespace, podName }) => {
    try {
      const metrics = await k8sMetricsClient.getPodMetrics(namespace);

      let items = metrics.items;

      // Filter by pod name if provided
      if (podName) {
        items = items.filter(m => m.metadata?.name === podName);
      }

      // Transform to a cleaner format
      const result = items.map(m => ({
        name: m.metadata?.name,
        namespace: m.metadata?.namespace,
        containers: m.containers.map((c: any) => ({
          name: c.name,
          usage: {
            cpu: c.usage.cpu,
            memory: c.usage.memory,
          },
        })),
      }));

      return JSON.stringify(result);
    } catch (e: any) {
      getLogger().error(`Error retrieving pod metrics: ${e.message}`);
      return `Error retrieving metrics: ${e.message}. Is metrics-server installed?`;
    }
  },
  {
    name: 'get_pod_metrics',
    description:
      'Gets current CPU and memory usage for pods from the Kubernetes metrics-server. Useful for identifying resource-hungry pods.',
    schema: z.object({
      namespace: z.string().describe('The kubernetes namespace to analyze'),
      podName: z.string().optional().describe('Filter by specific pod name'),
    })
  }
);

// Tool to get node metrics from metrics-server
export const getNodeMetricsTool = tool(
  async () => {
    try {
      const metrics = await k8sMetricsClient.getNodeMetrics();

      const result = metrics.items.map(m => ({
        name: m.metadata?.name,
        usage: {
          cpu: m.usage.cpu,
          memory: m.usage.memory,
        },
      }));

      return JSON.stringify(result);
    } catch (e: any) {
      getLogger().error(`Error retrieving node metrics: ${e.message}`);
      return `Error retrieving node metrics: ${e.message}. Is metrics-server installed?`;
    }
  },
  {
    name: 'get_node_metrics',
    description: 'Gets current CPU and memory usage for cluster nodes from the Kubernetes metrics-server.',
    schema: z.object({})
  }
);

// Export all deep dive tools as an array for easy use
export const deepDiveTools = [readPodLogsTool, getPodMetricsTool, getNodeMetricsTool];
