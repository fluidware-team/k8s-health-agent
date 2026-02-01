import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { k8sCoreApi } from '../cluster/k8sClient';
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

// Export all deep dive tools as an array for easy use
export const deepDiveTools = [readPodLogsTool];
