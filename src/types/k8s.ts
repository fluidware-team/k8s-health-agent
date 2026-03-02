// Types for filtering K8s API responses

export interface FilterOptions {
  onlyWarnings?: boolean;
}

export interface ContainerStatus {
  name: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    running?: { startedAt?: string };
    waiting?: { reason?: string; message?: string };
    terminated?: { reason?: string; exitCode?: number; message?: string };
  };
}

export interface PodCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export interface FilteredContainer {
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

export interface OwnerReference {
  kind: string;
  name: string;
}

export interface FilteredPod {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  labels?: Record<string, string>;
  containers: FilteredContainer[];
  conditions?: PodCondition[];
  ownerReferences?: OwnerReference[];
}

export interface FilteredNode {
  name: string;
  conditions: PodCondition[];
}

export interface FilteredEvent {
  reason: string;
  message: string;
  type: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace?: string;
  };
}
