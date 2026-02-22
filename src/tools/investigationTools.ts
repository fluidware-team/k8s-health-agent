import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { k8sCoreApi, k8sAppsApi } from '../cluster/k8sClient';

// Extract a human-readable message from a K8s API error.
function extractK8sErrorMessage(e: any, fallbackContext: string): string {
  if (typeof e.body === 'string') {
    try {
      const parsed = JSON.parse(e.body);
      if (parsed?.message) return parsed.message;
    } catch {
      return e.body;
    }
  }
  if (e.response?.body?.message) return e.response.body.message;
  if (e.message) return e.message;
  return `Unknown error for ${fallbackContext}`;
}

// Format condition list into readable lines: "Type=Status (Reason): message"
function formatConditions(conditions: any[]): string[] {
  if (conditions.length === 0) return [];
  return [
    'Conditions:',
    ...conditions.map(
      c => `  - ${c.type}=${c.status}${c.reason ? ` (${c.reason})` : ''}${c.message ? `: ${c.message}` : ''}`
    )
  ];
}

// Format warning events relevant to a specific resource (matched by name).
function formatEvents(events: any[], resourceName: string): string {
  const warnings = events.filter(e => e.involvedObject?.name === resourceName && e.type === 'Warning').slice(0, 10);

  if (warnings.length === 0) return 'No recent warning events.';

  return warnings
    .map(e => {
      const ts = e.lastTimestamp ?? e.eventTime ?? 'unknown';
      const count = e.count ? ` (x${e.count})` : '';
      return `  - ${e.reason}${count} at ${ts}: ${e.message}`;
    })
    .join('\n');
}

function formatContainerState(cs: any): string {
  const stateKey = Object.keys(cs.state ?? {})[0] ?? 'unknown';
  const stateInfo = cs.state?.[stateKey] ?? {};
  if (stateKey === 'waiting') return `waiting:${stateInfo.reason ?? ''}`;
  if (stateKey === 'terminated') return `terminated:${stateInfo.reason ?? ''} (exit ${stateInfo.exitCode ?? '?'})`;
  return stateKey;
}

function describeContainerStatuses(containerStatuses: any[]): string[] {
  if (containerStatuses.length === 0) return [];
  return [
    'Containers:',
    ...containerStatuses.map(
      cs => `  - ${cs.name}: ready=${cs.ready}, restarts=${cs.restartCount}, state=${formatContainerState(cs)}`
    )
  ];
}

function describePod(pod: any): string[] {
  const status = pod.status ?? {};
  return [
    `Phase: ${status.phase ?? 'Unknown'}`,
    ...formatConditions(status.conditions ?? []),
    ...describeContainerStatuses(status.containerStatuses ?? [])
  ];
}

function describeDeployment(deploy: any): string[] {
  const status = deploy.status ?? {};
  const spec = deploy.spec ?? {};
  const desired = spec.replicas ?? 1;

  const lines: string[] = [
    `Replicas: ${desired} desired, ${status.readyReplicas ?? 0} ready, ${status.availableReplicas ?? 0} available, ${status.updatedReplicas ?? 0} updated`,
    `Strategy: ${spec.strategy?.type ?? 'RollingUpdate'}`
  ];

  lines.push(...formatConditions(status.conditions ?? []));
  return lines;
}

function describeStatefulSet(sts: any): string[] {
  const status = sts.status ?? {};
  const spec = sts.spec ?? {};
  const desired = spec.replicas ?? 1;

  const lines: string[] = [
    `Replicas: ${desired} desired, ${status.readyReplicas ?? 0} ready, ${status.currentReplicas ?? 0} current`
  ];

  lines.push(...formatConditions(status.conditions ?? []));
  return lines;
}

function describeDaemonSet(ds: any): string[] {
  const status = ds.status ?? {};

  const lines: string[] = [
    `Scheduled: ${status.desiredNumberScheduled ?? 0} desired, ${status.numberReady ?? 0} ready, ${status.numberAvailable ?? 0} available`
  ];

  if (status.numberMisscheduled > 0) {
    lines.push(`Misscheduled: ${status.numberMisscheduled}`);
  }

  lines.push(...formatConditions(status.conditions ?? []));
  return lines;
}

// Tool to describe a Kubernetes resource — equivalent to kubectl describe.
// Returns status conditions, replica/container states, and recent warning events.
export const describeResourceTool = tool(
  async ({ kind, name, namespace }) => {
    try {
      // Fetch the resource and events in parallel
      const eventsPromise = k8sCoreApi.listNamespacedEvent({ namespace });

      let resourceLines: string[];
      switch (kind) {
        case 'pod': {
          const [res, eventsRes] = await Promise.all([
            k8sCoreApi.readNamespacedPod({ name, namespace }),
            eventsPromise
          ]);
          resourceLines = describePod(res);
          return [
            `## ${kind}/${name} (namespace: ${namespace})`,
            '',
            ...resourceLines,
            '',
            '### Recent Warning Events',
            formatEvents(eventsRes.items ?? [], name)
          ].join('\n');
        }
        case 'deployment': {
          const [res, eventsRes] = await Promise.all([
            k8sAppsApi.readNamespacedDeployment({ name, namespace }),
            eventsPromise
          ]);
          resourceLines = describeDeployment(res);
          return [
            `## ${kind}/${name} (namespace: ${namespace})`,
            '',
            ...resourceLines,
            '',
            '### Recent Warning Events',
            formatEvents(eventsRes.items ?? [], name)
          ].join('\n');
        }
        case 'statefulset': {
          const [res, eventsRes] = await Promise.all([
            k8sAppsApi.readNamespacedStatefulSet({ name, namespace }),
            eventsPromise
          ]);
          resourceLines = describeStatefulSet(res);
          return [
            `## ${kind}/${name} (namespace: ${namespace})`,
            '',
            ...resourceLines,
            '',
            '### Recent Warning Events',
            formatEvents(eventsRes.items ?? [], name)
          ].join('\n');
        }
        case 'daemonset': {
          const [res, eventsRes] = await Promise.all([
            k8sAppsApi.readNamespacedDaemonSet({ name, namespace }),
            eventsPromise
          ]);
          resourceLines = describeDaemonSet(res);
          return [
            `## ${kind}/${name} (namespace: ${namespace})`,
            '',
            ...resourceLines,
            '',
            '### Recent Warning Events',
            formatEvents(eventsRes.items ?? [], name)
          ].join('\n');
        }
      }
    } catch (e: any) {
      const msg = extractK8sErrorMessage(e, `${kind}/${name}`);
      return `Error describing ${kind}/${name}: ${msg}`;
    }
  },
  {
    name: 'describe_resource',
    description:
      'Describes a Kubernetes resource (pod, deployment, statefulset, daemonset), returning its status, conditions, replica/container states, and recent warning events. Equivalent to kubectl describe.',
    schema: z.object({
      kind: z.enum(['pod', 'deployment', 'statefulset', 'daemonset']).describe('The kind of resource to describe'),
      name: z.string().describe('The name of the resource'),
      namespace: z.string().describe('The namespace containing the resource')
    })
  }
);
