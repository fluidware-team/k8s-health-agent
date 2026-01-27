import { listPodsTool, listNodesTool, listEventsTool } from '../../tools/triageTools';
import type { TriageIssue, TriageResult, DiagnosticStateType } from '../state';

// Types for triage data
export interface FilteredPod {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  nodeName?: string;
  containers: {
    name: string;
    image: string;
    ready?: boolean;
    state?: string;
    stateMessage?: string;
  }[];
  conditions?: {
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }[];
}

export interface FilteredNode {
  name: string;
  conditions: {
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }[];
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
  taints?: { key: string; effect: string }[];
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
}

export interface TriageData {
  pods: FilteredPod[];
  nodes: FilteredNode[];
  events: FilteredEvent[];
}

// Critical reasons that require immediate investigation
const CRITICAL_REASONS = ['CrashLoopBackOff', 'OOMKilled', 'FailedMount', 'ImagePullBackOff', 'ErrImagePull'];
const WARNING_EVENT_REASONS = ['BackOff', 'FailedScheduling', 'FailedCreate', 'Unhealthy'];
const HIGH_RESTART_THRESHOLD = 3;

export function extractTriageIssues(
  pods: FilteredPod[],
  nodes: FilteredNode[],
  events: FilteredEvent[]
): TriageIssue[] {
  const issues: TriageIssue[] = [];
  const seenPods = new Set<string>();

  // Check pods for issues
  for (const pod of pods) {
    const podKey = `${pod.namespace}/${pod.name}`;

    // Check each container
    for (const container of pod.containers) {
      if (container.state && CRITICAL_REASONS.includes(container.state)) {
        if (!seenPods.has(podKey)) {
          seenPods.add(podKey);
          issues.push({
            podName: pod.name,
            namespace: pod.namespace,
            containerName: container.name,
            reason: container.state,
            severity: 'critical',
            restarts: pod.restarts,
            message: container.stateMessage,
          });
        }
      }
    }

    // Check for high restart count (only if not already flagged for a critical issue)
    if (!seenPods.has(podKey) && pod.restarts >= HIGH_RESTART_THRESHOLD) {
      issues.push({
        podName: pod.name,
        namespace: pod.namespace,
        reason: 'HighRestartCount',
        severity: 'warning',
        restarts: pod.restarts,
      });
      seenPods.add(podKey);
    }

    // Check for Pending status
    if (!seenPods.has(podKey) && pod.status === 'Pending') {
      const scheduledCondition = pod.conditions?.find(c => c.type === 'PodScheduled');
      issues.push({
        podName: pod.name,
        namespace: pod.namespace,
        reason: 'Pending',
        severity: 'warning',
        message: scheduledCondition?.message || 'Pod is pending',
      });
      seenPods.add(podKey);
    }

    // Check for Failed status
    if (!seenPods.has(podKey) && pod.status === 'Failed') {
      issues.push({
        podName: pod.name,
        namespace: pod.namespace,
        reason: 'Failed',
        severity: 'critical',
      });
      seenPods.add(podKey);
    }
  }

  // Check events for issues
  for (const event of events) {
    if (event.involvedObject?.kind !== 'Pod') continue;

    const podKey = `${event.involvedObject.namespace || 'default'}/${event.involvedObject.name}`;

    // Skip if pod already has a critical issue
    if (seenPods.has(podKey)) continue;

    if (CRITICAL_REASONS.includes(event.reason)) {
      seenPods.add(podKey);
      issues.push({
        podName: event.involvedObject.name,
        namespace: event.involvedObject.namespace || 'default',
        reason: event.reason,
        severity: 'critical',
        message: event.message,
      });
    } else if (WARNING_EVENT_REASONS.includes(event.reason)) {
      seenPods.add(podKey);
      issues.push({
        podName: event.involvedObject.name,
        namespace: event.involvedObject.namespace || 'default',
        reason: event.reason,
        severity: 'warning',
        message: event.message,
      });
    }
  }

  return issues;
}

function getNodeStatus(nodes: FilteredNode[]): 'healthy' | 'warning' | 'critical' {
  for (const node of nodes) {
    const readyCondition = node.conditions.find(c => c.type === 'Ready');
    if (readyCondition && readyCondition.status !== 'True') {
      return 'critical';
    }

    // Check for pressure conditions
    const pressureConditions = node.conditions.filter(c =>
      ['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(c.type)
    );
    for (const cond of pressureConditions) {
      if (cond.status === 'True') {
        return 'warning';
      }
    }
  }

  return 'healthy';
}

export function analyzeTriageData(
  data: TriageData,
  namespace: string
): { triageResult: TriageResult; needsDeepDive: boolean } {
  const issues = extractTriageIssues(data.pods, data.nodes, data.events);

  const healthyPods = data.pods
    .filter(p => p.status === 'Running' && p.restarts < HIGH_RESTART_THRESHOLD)
    .filter(p => !issues.some(i => i.podName === p.name))
    .map(p => p.name);

  const nodeStatus = getNodeStatus(data.nodes);

  const eventsSummary = data.events.filter(e => e.type === 'Warning').map(e => `${e.reason}: ${e.message}`);

  const triageResult: TriageResult = {
    issues,
    healthyPods,
    nodeStatus,
    eventsSummary,
  };

  // Need deep dive if there are any critical issues or warnings
  const needsDeepDive = issues.some(i => i.severity === 'critical') || issues.length > 0;

  return { triageResult, needsDeepDive };
}

// The actual node function for LangGraph
export async function triageNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const namespace = state.namespace;

  // Use the tools to gather data
  const [podsResult, nodesResult, eventsResult] = await Promise.all([
    listPodsTool.invoke({ namespace }),
    listNodesTool.invoke({}),
    listEventsTool.invoke({ namespace }),
  ]);

  // Parse the results
  let pods: FilteredPod[] = [];
  let nodes: FilteredNode[] = [];
  let events: FilteredEvent[] = [];

  try {
    pods = JSON.parse(podsResult as string);
  } catch {
    pods = [];
  }

  try {
    nodes = JSON.parse(nodesResult as string);
  } catch {
    nodes = [];
  }

  try {
    events = JSON.parse(eventsResult as string);
  } catch {
    events = [];
  }

  const { triageResult, needsDeepDive } = analyzeTriageData({ pods, nodes, events }, namespace);

  return {
    triageResult,
    needsDeepDive,
  };
}
