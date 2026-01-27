export interface ContainerResources {
  name: string;
  requests?: {
    cpu?: string;
    memory?: string;
  };
  limits?: {
    cpu?: string;
    memory?: string;
  };
}

export interface ContainerMetrics {
  name: string;
  usage: {
    cpu: string;
    memory: string;
  };
}

export interface PodResourceData {
  name: string;
  containers: ContainerResources[];
}

export interface PodMetricsData {
  name: string;
  containers: ContainerMetrics[];
}

export interface ResourceRecommendation {
  type: 'increase' | 'reduce' | 'add';
  resource: 'cpu' | 'memory';
  containerName: string;
  currentRequest?: string | undefined;
  currentLimit?: string | undefined;
  suggestedRequest?: string | undefined;
  suggestedLimit?: string | undefined;
  reason: string;
}

export interface ResourceAnalysis {
  podName: string;
  containerName: string;
  status: 'right-sized' | 'over-provisioned' | 'under-provisioned' | 'unknown';
  recommendations: ResourceRecommendation[];
  warnings: string[];
  metrics: {
    cpuUsage: number;
    memoryUsage: number;
    cpuRequest?: number | undefined;
    cpuLimit?: number | undefined;
    memoryRequest?: number | undefined;
    memoryLimit?: number | undefined;
  };
}

// Parse resource quantity strings (e.g., "100m", "1Gi", "500000000n")
export function parseResourceQuantity(quantity: string): number {
  const value = parseFloat(quantity);

  // Millicores (e.g., "100m")
  if (quantity.endsWith('m')) {
    return value / 1000;
  }

  // Nanocores (e.g., "500000000n" from metrics-server)
  if (quantity.endsWith('n')) {
    return value / 1_000_000_000;
  }

  // Memory units
  if (quantity.endsWith('Ki')) {
    return parseFloat(quantity.slice(0, -2)) * 1024;
  }
  if (quantity.endsWith('Mi')) {
    return parseFloat(quantity.slice(0, -2)) * 1024 * 1024;
  }
  if (quantity.endsWith('Gi')) {
    return parseFloat(quantity.slice(0, -2)) * 1024 * 1024 * 1024;
  }
  if (quantity.endsWith('Ti')) {
    return parseFloat(quantity.slice(0, -2)) * 1024 * 1024 * 1024 * 1024;
  }

  // Plain number (CPU cores or bytes)
  return value;
}

// Format bytes to human readable
function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))}Gi`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}Mi`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}Ki`;
  }
  return `${bytes}`;
}

// Format CPU to human readable
function formatCPU(cores: number): string {
  if (cores < 1) {
    return `${Math.round(cores * 1000)}m`;
  }
  return `${cores}`;
}

// Thresholds for recommendations
const OVER_PROVISIONED_THRESHOLD = 0.3; // Using less than 30% of request
const UNDER_PROVISIONED_THRESHOLD = 0.8; // Using more than 80% of limit
const HEADROOM_MULTIPLIER = 1.5; // Add 50% headroom for recommendations

export function analyzeResources(
  resources: PodResourceData,
  metrics: PodMetricsData
): ResourceAnalysis {
  const recommendations: ResourceRecommendation[] = [];
  const warnings: string[] = [];

  // Get the first container (most common case)
  const container = resources.containers[0];
  const containerMetrics = metrics.containers.find(c => c.name === container?.name) || metrics.containers[0];

  if (!container || !containerMetrics) {
    return {
      podName: resources.name,
      containerName: container?.name || 'unknown',
      status: 'unknown',
      recommendations: [],
      warnings: ['Could not find container data'],
      metrics: { cpuUsage: 0, memoryUsage: 0 },
    };
  }

  const cpuUsage = parseResourceQuantity(containerMetrics.usage.cpu);
  const memoryUsage = parseResourceQuantity(containerMetrics.usage.memory);

  const cpuRequest = container.requests?.cpu ? parseResourceQuantity(container.requests.cpu) : undefined;
  const cpuLimit = container.limits?.cpu ? parseResourceQuantity(container.limits.cpu) : undefined;
  const memoryRequest = container.requests?.memory ? parseResourceQuantity(container.requests.memory) : undefined;
  const memoryLimit = container.limits?.memory ? parseResourceQuantity(container.limits.memory) : undefined;

  // Check for missing requests/limits
  if (!cpuRequest) {
    warnings.push(`Container "${container.name}" has no CPU request set`);
  }
  if (!memoryRequest) {
    warnings.push(`Container "${container.name}" has no memory request set`);
  }
  if (!cpuLimit) {
    warnings.push(`Container "${container.name}" has no CPU limit set`);
  }
  if (!memoryLimit) {
    warnings.push(`Container "${container.name}" has no memory limit set`);
  }

  let status: ResourceAnalysis['status'] = 'right-sized';

  // Check CPU
  if (cpuRequest && cpuUsage / cpuRequest < OVER_PROVISIONED_THRESHOLD) {
    status = 'over-provisioned';
    const suggested = Math.ceil(cpuUsage * HEADROOM_MULTIPLIER * 1000) / 1000;
    recommendations.push({
      type: 'reduce',
      resource: 'cpu',
      containerName: container.name,
      currentRequest: container.requests?.cpu,
      currentLimit: container.limits?.cpu,
      suggestedRequest: formatCPU(suggested),
      suggestedLimit: formatCPU(suggested * 2),
      reason: `Using only ${formatCPU(cpuUsage)} of ${container.requests?.cpu} requested`,
    });
  } else if (cpuLimit && cpuUsage / cpuLimit > UNDER_PROVISIONED_THRESHOLD) {
    status = 'under-provisioned';
    const suggested = Math.ceil(cpuUsage * HEADROOM_MULTIPLIER * 1000) / 1000;
    recommendations.push({
      type: 'increase',
      resource: 'cpu',
      containerName: container.name,
      currentRequest: container.requests?.cpu,
      currentLimit: container.limits?.cpu,
      suggestedRequest: formatCPU(suggested),
      suggestedLimit: formatCPU(suggested * 2),
      reason: `Using ${formatCPU(cpuUsage)} which is ${Math.round((cpuUsage / cpuLimit) * 100)}% of limit`,
    });
  }

  // Check Memory
  if (memoryRequest && memoryUsage / memoryRequest < OVER_PROVISIONED_THRESHOLD) {
    if (status === 'right-sized') status = 'over-provisioned';
    const suggested = Math.ceil(memoryUsage * HEADROOM_MULTIPLIER);
    recommendations.push({
      type: 'reduce',
      resource: 'memory',
      containerName: container.name,
      currentRequest: container.requests?.memory,
      currentLimit: container.limits?.memory,
      suggestedRequest: formatMemory(suggested),
      suggestedLimit: formatMemory(suggested * 2),
      reason: `Using only ${formatMemory(memoryUsage)} of ${container.requests?.memory} requested`,
    });
  } else if (memoryLimit && memoryUsage / memoryLimit > UNDER_PROVISIONED_THRESHOLD) {
    status = 'under-provisioned';
    const suggested = Math.ceil(memoryUsage * HEADROOM_MULTIPLIER);
    recommendations.push({
      type: 'increase',
      resource: 'memory',
      containerName: container.name,
      currentRequest: container.requests?.memory,
      currentLimit: container.limits?.memory,
      suggestedRequest: formatMemory(suggested),
      suggestedLimit: formatMemory(suggested * 2),
      reason: `Using ${formatMemory(memoryUsage)} which is ${Math.round((memoryUsage / memoryLimit) * 100)}% of limit`,
    });
  }

  return {
    podName: resources.name,
    containerName: container.name,
    status,
    recommendations,
    warnings,
    metrics: {
      cpuUsage,
      memoryUsage,
      cpuRequest,
      cpuLimit,
      memoryRequest,
      memoryLimit,
    },
  };
}

export function formatRecommendation(rec: ResourceRecommendation): string {
  const action = rec.type === 'increase' ? 'Increase' : rec.type === 'reduce' ? 'Reduce' : 'Add';
  let text = `${action} ${rec.resource} for container "${rec.containerName}": `;
  text += rec.reason;

  if (rec.suggestedRequest) {
    text += `\n  Suggested request: ${rec.suggestedRequest}`;
  }
  if (rec.suggestedLimit) {
    text += `\n  Suggested limit: ${rec.suggestedLimit}`;
  }

  return text;
}
