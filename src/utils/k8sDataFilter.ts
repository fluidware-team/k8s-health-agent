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

function getPodIdentity(pod: any): { name: string; namespace: string; status: string } {
  return {
    name: pod.metadata?.name || '',
    namespace: pod.metadata?.namespace || 'default',
    status: pod.status?.phase || 'Unknown'
  };
}

function buildFilteredPod(
  pod: any,
  containers: FilteredContainer[],
  restarts: number,
  conditions: PodCondition[],
  ownerReferences: OwnerReference[] | undefined
): FilteredPod {
  const nodeName = pod.spec?.nodeName;
  return {
    ...getPodIdentity(pod),
    restarts,
    containers,
    ...(nodeName && { nodeName }),
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

function isUnhealthyCondition(c: PodCondition): boolean {
  if (c.type === 'Ready') return c.status !== 'True';
  return c.status === 'True';
}

function filterNodeConditions(conditions: PodCondition[], onlyUnhealthy: boolean): PodCondition[] {
  const mapped = conditions.map(mapCondition);
  return onlyUnhealthy ? mapped.filter(isUnhealthyCondition) : mapped;
}

function mapTaints(taints: any[]): FilteredNode['taints'] {
  return taints.map(t => ({
    key: t.key,
    effect: t.effect,
    ...(t.value && { value: t.value })
  }));
}

function getNodeConditions(node: any): PodCondition[] {
  return node.status?.conditions || [];
}

function getNodeTaints(node: any): FilteredNode['taints'] | undefined {
  const taints = node.spec?.taints;
  return taints?.length > 0 ? mapTaints(taints) : undefined;
}

function buildFilteredNode(
  node: any,
  conditions: PodCondition[],
  taints: FilteredNode['taints'] | undefined
): FilteredNode {
  const capacity = node.status?.capacity;
  const allocatable = node.status?.allocatable;
  return {
    name: node.metadata?.name || '',
    conditions,
    ...(capacity && { capacity }),
    ...(allocatable && { allocatable }),
    ...(taints && { taints })
  };
}

export function filterNodeData(node: any, options: FilterOptions = {}): FilteredNode {
  const conditions = filterNodeConditions(getNodeConditions(node), !!options.onlyUnhealthy);
  const taints = getNodeTaints(node);
  return buildFilteredNode(node, conditions, taints);
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
    count: event.count,
    involvedObject: {
      kind: event.involvedObject?.kind,
      name: event.involvedObject?.name,
      ...(event.involvedObject?.namespace && { namespace: event.involvedObject.namespace })
    },
    ...(event.firstTimestamp && { firstTimestamp: event.firstTimestamp }),
    ...(event.lastTimestamp && { lastTimestamp: event.lastTimestamp })
  };
}
