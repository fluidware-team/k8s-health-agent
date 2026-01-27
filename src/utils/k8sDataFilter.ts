interface FilterOptions {
  onlyUnhealthy?: boolean;
  onlyWarnings?: boolean;
}

interface ContainerStatus {
  name: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    running?: { startedAt?: string };
    waiting?: { reason?: string; message?: string };
    terminated?: { reason?: string; exitCode?: number; message?: string };
  };
}

interface PodCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

interface FilteredContainer {
  name: string;
  image: string;
  ready?: boolean | undefined;
  state?: string;
  stateMessage?: string;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
}

interface FilteredPod {
  name: string;
  namespace: string;
  status: string;
  nodeName?: string;
  restarts: number;
  containers: FilteredContainer[];
  conditions?: PodCondition[];
}

interface FilteredNode {
  name: string;
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
  conditions: PodCondition[];
  taints?: { key: string; effect: string; value?: string }[];
}

interface FilteredEvent {
  reason: string;
  message: string;
  type: string;
  count?: number;
  involvedObject: {
    kind: string;
    name: string;
    namespace?: string;
  };
  firstTimestamp?: string;
  lastTimestamp?: string;
}

function extractContainerState(containerStatus: ContainerStatus): { state?: string; stateMessage?: string } {
  if (containerStatus.state?.waiting) {
    const result: { state?: string; stateMessage?: string } = {};
    if (containerStatus.state.waiting.reason) {
      result.state = containerStatus.state.waiting.reason;
    }
    if (containerStatus.state.waiting.message) {
      result.stateMessage = containerStatus.state.waiting.message;
    }
    return result;
  }
  if (containerStatus.state?.terminated) {
    const result: { state?: string; stateMessage?: string } = {};
    if (containerStatus.state.terminated.reason) {
      result.state = containerStatus.state.terminated.reason;
    }
    if (containerStatus.state.terminated.message) {
      result.stateMessage = containerStatus.state.terminated.message;
    }
    return result;
  }
  if (containerStatus.state?.running) {
    return { state: 'Running' };
  }
  return {};
}

export function filterPodData(pod: any): FilteredPod {
  const containerStatuses: ContainerStatus[] = pod.status?.containerStatuses || [];
  const containers = (pod.spec?.containers || []).map((container: any) => {
    const status = containerStatuses.find(s => s.name === container.name);
    const stateInfo = status ? extractContainerState(status) : {};

    const filteredContainer: FilteredContainer = {
      name: container.name,
      image: container.image,
      ready: status?.ready,
      ...stateInfo,
    };

    if (container.resources && (container.resources.requests || container.resources.limits)) {
      filteredContainer.resources = {};
      if (container.resources.requests) {
        filteredContainer.resources.requests = container.resources.requests;
      }
      if (container.resources.limits) {
        filteredContainer.resources.limits = container.resources.limits;
      }
    }

    return filteredContainer;
  });

  // Calculate total restarts across all containers
  const restarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);

  // Filter conditions to only include non-True ones or important ones
  const conditions = (pod.status?.conditions || [])
    .filter((c: PodCondition) => c.status !== 'True' || c.type === 'Ready')
    .map((c: PodCondition) => ({
      type: c.type,
      status: c.status,
      ...(c.reason && { reason: c.reason }),
      ...(c.message && { message: c.message }),
    }));

  const filtered: FilteredPod = {
    name: pod.metadata?.name || '',
    namespace: pod.metadata?.namespace || 'default',
    status: pod.status?.phase || 'Unknown',
    restarts,
    containers,
  };

  if (pod.spec?.nodeName) {
    filtered.nodeName = pod.spec.nodeName;
  }

  if (conditions.length > 0) {
    filtered.conditions = conditions;
  }

  return filtered;
}

export function filterNodeData(node: any, options: FilterOptions = {}): FilteredNode {
  let conditions = (node.status?.conditions || []).map((c: any) => ({
    type: c.type,
    status: c.status,
    ...(c.reason && { reason: c.reason }),
    ...(c.message && { message: c.message }),
  }));

  if (options.onlyUnhealthy) {
    conditions = conditions.filter((c: PodCondition) => {
      // Ready should be True for healthy, all others should be False for healthy
      if (c.type === 'Ready') {
        return c.status !== 'True';
      }
      return c.status === 'True';
    });
  }

  const filtered: FilteredNode = {
    name: node.metadata?.name || '',
    conditions,
  };

  if (node.status?.capacity) {
    filtered.capacity = node.status.capacity;
  }

  if (node.status?.allocatable) {
    filtered.allocatable = node.status.allocatable;
  }

  if (node.spec?.taints?.length > 0) {
    filtered.taints = node.spec.taints.map((t: any) => ({
      key: t.key,
      effect: t.effect,
      ...(t.value && { value: t.value }),
    }));
  }

  return filtered;
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
      ...(event.involvedObject?.namespace && { namespace: event.involvedObject.namespace }),
    },
    ...(event.firstTimestamp && { firstTimestamp: event.firstTimestamp }),
    ...(event.lastTimestamp && { lastTimestamp: event.lastTimestamp }),
  };
}
