import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getLogger } from '@fluidware-it/saddlebag';
import { k8sCoreApi, k8sAppsApi } from '../cluster/k8sClient';
import { extractK8sErrorMessage } from '../utils/k8sErrorUtils';

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

// --- getWorkloadSpecTool helpers ---

function formatResources(resources: any): string {
  if (!resources) return '';
  const parts: string[] = [];
  const fmt = (obj: Record<string, unknown>) =>
    Object.entries(obj)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  if (resources.requests) parts.push(`requests={${fmt(resources.requests)}}`);
  if (resources.limits) parts.push(`limits={${fmt(resources.limits)}}`);
  return parts.join(', ');
}

function formatProbe(probe: any): string {
  if (probe.httpGet) return `httpGet ${probe.httpGet.path}:${probe.httpGet.port}`;
  if (probe.exec) return `exec [${(probe.exec.command ?? []).join(' ')}]`;
  if (probe.tcpSocket) return `tcpSocket :${probe.tcpSocket.port}`;
  return 'configured';
}

function formatVolume(vol: any): string {
  if (vol.configMap) return `${vol.name} (configMap: ${vol.configMap.name})`;
  if (vol.secret) return `${vol.name} (secret: ${vol.secret.secretName})`;
  if (vol.persistentVolumeClaim) return `${vol.name} (pvc: ${vol.persistentVolumeClaim.claimName})`;
  if (vol.emptyDir !== undefined) return `${vol.name} (emptyDir)`;
  if (vol.hostPath) return `${vol.name} (hostPath: ${vol.hostPath.path})`;
  return `${vol.name} (other)`;
}

// Format a single container spec — env var names only, never values.
function formatContainerSpec(container: any): string[] {
  const lines: string[] = [`**${container.name}:**`, `  Image: ${container.image}`];

  const resources = formatResources(container.resources);
  if (resources) lines.push(`  Resources: ${resources}`);

  if (container.env?.length > 0) {
    lines.push(`  Env vars (names only): ${container.env.map((e: any) => e.name).join(', ')}`);
  }

  if (container.ports?.length > 0) {
    lines.push(`  Ports: ${container.ports.map((p: any) => `${p.containerPort}/${p.protocol ?? 'TCP'}`).join(', ')}`);
  }

  if (container.livenessProbe) lines.push(`  Liveness probe: ${formatProbe(container.livenessProbe)}`);
  if (container.readinessProbe) lines.push(`  Readiness probe: ${formatProbe(container.readinessProbe)}`);

  return lines;
}

function formatContainerList(containers: any[]): string[] {
  if (containers.length === 0) return [];
  const lines: string[] = ['', '### Containers', ''];
  for (const c of containers) lines.push(...formatContainerSpec(c), '');
  return lines;
}

function formatVolumeList(volumes: any[]): string[] {
  if (volumes.length === 0) return [];
  const lines: string[] = ['### Volumes'];
  for (const v of volumes) lines.push(`  - ${formatVolume(v)}`);
  return lines;
}

// Build output lines from a workload spec (shared by deployment/statefulset/daemonset).
function buildWorkloadSpecLines(kind: string, name: string, namespace: string, spec: any): string[] {
  const template = spec.template?.spec ?? {};
  const lines: string[] = [`## ${kind}/${name} (namespace: ${namespace})`];

  if (spec.replicas !== undefined) lines.push(`Replicas: ${spec.replicas}`);
  if (spec.strategy?.type) lines.push(`Strategy: ${spec.strategy.type}`);

  lines.push(...formatContainerList(template.containers ?? []));
  lines.push(...formatVolumeList(template.volumes ?? []));

  return lines;
}

// Tool to describe a Kubernetes resource — equivalent to kubectl describe.
// Returns status conditions, replica/container states, and recent warning events.
export const describeResourceTool = tool(
  async ({ kind, name, namespace }) => {
    getLogger().info(`[tool] describe_resource: ${kind}/${name} in ${namespace}`);
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
        default:
          return `Unsupported resource kind: ${kind}`;
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

// Tool to fetch the workload spec (deployment/statefulset/daemonset).
// Returns: replicas, rollout strategy, container images, resource requests/limits,
// env var names (never values), ports, probes, and volumes.
export const getWorkloadSpecTool = tool(
  async ({ kind, name, namespace }) => {
    getLogger().info(`[tool] get_workload_spec: ${kind}/${name} in ${namespace}`);
    try {
      let raw: any;
      switch (kind) {
        case 'deployment':
          raw = await k8sAppsApi.readNamespacedDeployment({ name, namespace });
          break;
        case 'statefulset':
          raw = await k8sAppsApi.readNamespacedStatefulSet({ name, namespace });
          break;
        case 'daemonset':
          raw = await k8sAppsApi.readNamespacedDaemonSet({ name, namespace });
          break;
        default:
          return `Unsupported workload kind: ${kind}`;
      }
      return buildWorkloadSpecLines(kind, name, namespace, raw.spec ?? {}).join('\n');
    } catch (e: any) {
      const msg = extractK8sErrorMessage(e, `${kind}/${name}`);
      return `Error fetching spec for ${kind}/${name}: ${msg}`;
    }
  },
  {
    name: 'get_workload_spec',
    description:
      'Fetches the workload spec for a Deployment, StatefulSet, or DaemonSet. Returns replica count, rollout strategy, container images, resource requests/limits, environment variable names (never values), ports, liveness/readiness probes, and volumes. Useful for diagnosing misconfigurations and resource sizing issues.',
    schema: z.object({
      kind: z.enum(['deployment', 'statefulset', 'daemonset']).describe('The kind of workload to inspect'),
      name: z.string().describe('The name of the workload'),
      namespace: z.string().describe('The namespace containing the workload')
    })
  }
);

// Format a list of resources (configmaps or secrets) as readable lines.
function formatResourceList(items: any[], label: string, formatItem: (item: any) => string): string {
  if (items.length === 0) return `No ${label} found.`;
  return [`${label} (${items.length}):`, ...items.map(i => `  - ${formatItem(i)}`)].join('\n');
}

function formatConfigMap(cm: any): string {
  const ts = cm.metadata?.creationTimestamp ?? 'unknown';
  return `${cm.metadata?.name} (created: ${ts})`;
}

function formatSecret(secret: any): string {
  const ts = secret.metadata?.creationTimestamp ?? 'unknown';
  const type = secret.type ?? 'Opaque';
  return `${secret.metadata?.name} [${type}] (created: ${ts})`;
}

function applyPrefix(items: any[], namePrefix?: string): any[] {
  if (!namePrefix) return items;
  return items.filter(i => i.metadata?.name?.startsWith(namePrefix));
}

// Tool to list ConfigMaps and Secrets by name — never exposes values.
// Useful for verifying that a referenced config or secret actually exists.
export const listConfigsAndSecretsTool = tool(
  async ({ namespace, namePrefix }) => {
    getLogger().info(`[tool] list_configmaps_and_secrets in ${namespace}${namePrefix ? ` (prefix: ${namePrefix})` : ''}`);
    try {
      const [cmRes, secretRes] = await Promise.all([
        k8sCoreApi.listNamespacedConfigMap({ namespace }),
        k8sCoreApi.listNamespacedSecret({ namespace })
      ]);

      const configMaps = applyPrefix(cmRes.items ?? [], namePrefix);
      const secrets = applyPrefix(secretRes.items ?? [], namePrefix);

      return [
        `## ConfigMaps and Secrets in namespace: ${namespace}${namePrefix ? ` (prefix: "${namePrefix}")` : ''}`,
        '',
        formatResourceList(configMaps, 'ConfigMaps', formatConfigMap),
        '',
        formatResourceList(secrets, 'Secrets', formatSecret)
      ].join('\n');
    } catch (e: any) {
      const msg = extractK8sErrorMessage(e, `namespace ${namespace}`);
      return `Error listing configs and secrets in ${namespace}: ${msg}`;
    }
  },
  {
    name: 'list_configmaps_and_secrets',
    description:
      'Lists ConfigMaps and Secrets in a namespace by name only — never exposes values. Useful for verifying that a referenced ConfigMap or Secret actually exists when logs report missing configs or secrets.',
    schema: z.object({
      namespace: z.string().describe('The namespace to list resources in'),
      namePrefix: z
        .string()
        .optional()
        .describe('Optional prefix to filter resources by name (e.g. "app-" to list only app-* entries)')
    })
  }
);
