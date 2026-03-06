import type {
  FilterOptions,
  ContainerStatus,
  PodCondition,
  FilteredContainer,
  FilteredPod,
  FilteredNode,
  FilteredEvent,
  OwnerReference
} from '../types/k8s';

interface ContainerStateResult {
  state?: string;
  stateMessage?: string;
}

function buildStateResult(reason?: string, message?: string): ContainerStateResult {
  const result: ContainerStateResult = {};
  if (reason) result.state = reason;
  if (message) result.stateMessage = message;
  return result;
}

function extractContainerState(containerStatus: ContainerStatus): ContainerStateResult {
  const { state } = containerStatus;
  if (!state) return {};

  if (state.waiting) {
    return buildStateResult(state.waiting.reason, state.waiting.message);
  }
  if (state.terminated) {
    return buildStateResult(state.terminated.reason, state.terminated.message);
  }
  if (state.running) {
    return { state: 'Running' };
  }
  return {};
}

function buildContainerResources(container: any): FilteredContainer['resources'] | undefined {
  const { resources } = container;
  if (!resources || (!resources.requests && !resources.limits)) {
    return undefined;
  }
  const result: FilteredContainer['resources'] = {};
  if (resources.requests) result.requests = resources.requests;
  if (resources.limits) result.limits = resources.limits;
  return result;
}

function mapContainer(container: any, containerStatuses: ContainerStatus[]): FilteredContainer {
  const status = containerStatuses.find(s => s.name === container.name);
  const stateInfo = status ? extractContainerState(status) : {};
  const resources = buildContainerResources(container);

  return {
    name: container.name,
    image: container.image,
    ready: status?.ready,
    ...stateInfo,
    ...(resources && { resources })
  };
}

function mapCondition(c: PodCondition): PodCondition {
  return {
    type: c.type,
    status: c.status,
    ...(c.reason && { reason: c.reason }),
    ...(c.message && { message: c.message })
  };
}

function filterPodConditions(conditions: PodCondition[]): PodCondition[] {
  return conditions.filter(c => c.status !== 'True' || c.type === 'Ready').map(mapCondition);
}

function getContainerStatuses(pod: any): ContainerStatus[] {
  return pod.status?.containerStatuses || [];
}

function getSpecContainers(pod: any): any[] {
  return pod.spec?.containers || [];
}

function getPodConditions(pod: any): PodCondition[] {
  return pod.status?.conditions || [];
}

function calculateRestarts(containerStatuses: ContainerStatus[]): number {
  return containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);
}

function extractOwnerReferences(pod: any): OwnerReference[] | undefined {
  const refs = pod.metadata?.ownerReferences;
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  return refs.map((ref: any) => ({
    kind: ref.kind,
    name: ref.name
  }));
}

function getPodIdentity(pod: any): {
  name: string;
  namespace: string;
  status: string;
  labels?: Record<string, string>;
} {
  return {
    name: pod.metadata?.name || '',
    namespace: pod.metadata?.namespace || 'default',
    status: pod.status?.phase || 'Unknown',
    ...(pod.metadata?.labels && Object.keys(pod.metadata.labels).length > 0 && { labels: pod.metadata.labels })
  };
}

function buildFilteredPod(
  pod: any,
  containers: FilteredContainer[],
  restarts: number,
  conditions: PodCondition[],
  ownerReferences: OwnerReference[] | undefined
): FilteredPod {
  return {
    ...getPodIdentity(pod),
    restarts,
    containers,
    ...(conditions.length > 0 && { conditions }),
    ...(ownerReferences && { ownerReferences })
  };
}

export function filterPodData(pod: any): FilteredPod {
  const containerStatuses = getContainerStatuses(pod);
  const containers = getSpecContainers(pod).map((c: any) => mapContainer(c, containerStatuses));
  const restarts = calculateRestarts(containerStatuses);
  const conditions = filterPodConditions(getPodConditions(pod));
  const ownerReferences = extractOwnerReferences(pod);
  return buildFilteredPod(pod, containers, restarts, conditions, ownerReferences);
}

function filterNodeConditions(conditions: PodCondition[]): PodCondition[] {
  return conditions.map(mapCondition);
}

function getNodeConditions(node: any): PodCondition[] {
  return node.status?.conditions || [];
}

export function filterNodeData(node: any): FilteredNode {
  return {
    name: node.metadata?.name || '',
    conditions: filterNodeConditions(getNodeConditions(node))
  };
}

function buildInvolvedObject(involvedObject: any): FilteredEvent['involvedObject'] {
  return {
    kind: involvedObject?.kind,
    name: involvedObject?.name,
    ...(involvedObject?.namespace && { namespace: involvedObject.namespace })
  };
}

export function filterEventData(event: any, options: FilterOptions = {}): FilteredEvent | null {
  // If onlyWarnings is set, check if this is a Warning event
  if (options.onlyWarnings && event.type !== 'Warning') {
    return null;
  }

  return {
    reason: event.reason,
    message: event.message,
    type: event.type,
    ...(event.count && { count: event.count }),
    ...(event.firstTimestamp && { firstTimestamp: event.firstTimestamp }),
    ...(event.lastTimestamp && { lastTimestamp: event.lastTimestamp }),
    involvedObject: buildInvolvedObject(event.involvedObject)
  };
}
