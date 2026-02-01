// Types for filtering K8s API responses

export interface FilterOptions {
  onlyUnhealthy?: boolean;
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

export interface FilteredPod {
  name: string;
  namespace: string;
  status: string;
  nodeName?: string;
  restarts: number;
  containers: FilteredContainer[];
  conditions?: PodCondition[];
}

export interface FilteredNode {
  name: string;
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
  conditions: PodCondition[];
  taints?: { key: string; effect: string; value?: string }[];
}

export interface FilteredEvent {
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
