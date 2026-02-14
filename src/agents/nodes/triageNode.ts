import { getLogger } from '@fluidware-it/saddlebag';
import { listPodsTool, listNodesTool, listEventsTool } from '../../tools/triageTools';
import type { TriageIssue, TriageResult, DiagnosticStateType } from '../state';
import type { FilteredPod, FilteredNode, FilteredEvent, TriageData } from '../../types';
import { buildOwnerMap, resolveOwner, type OwnerMap } from '../../utils/ownerResolver';

const logger = getLogger();

// Critical reasons that require immediate investigation
const CRITICAL_REASONS = ['CrashLoopBackOff', 'OOMKilled', 'FailedMount', 'ImagePullBackOff', 'ErrImagePull'];
const WARNING_EVENT_REASONS = ['BackOff', 'FailedScheduling', 'FailedCreate', 'Unhealthy'];
const HIGH_RESTART_THRESHOLD = 3;

function checkContainerIssues(pod: FilteredPod, podKey: string, seenPods: Set<string>, issues: TriageIssue[]): void {
  for (const container of pod.containers) {
    if (container.state && CRITICAL_REASONS.includes(container.state) && !seenPods.has(podKey)) {
      seenPods.add(podKey);
      issues.push({
        podName: pod.name,
        namespace: pod.namespace,
        containerName: container.name,
        reason: container.state,
        severity: 'critical',
        restarts: pod.restarts,
        message: container.stateMessage
      });
    }
  }
}

function checkPodStatusIssues(pod: FilteredPod, podKey: string, seenPods: Set<string>, issues: TriageIssue[]): void {
  if (seenPods.has(podKey)) return;

  if (pod.restarts >= HIGH_RESTART_THRESHOLD) {
    issues.push({
      podName: pod.name,
      namespace: pod.namespace,
      reason: 'HighRestartCount',
      severity: 'warning',
      restarts: pod.restarts
    });
    seenPods.add(podKey);
    return;
  }

  if (pod.status === 'Pending') {
    const scheduledCondition = pod.conditions?.find(c => c.type === 'PodScheduled');
    issues.push({
      podName: pod.name,
      namespace: pod.namespace,
      reason: 'Pending',
      severity: 'warning',
      message: scheduledCondition?.message || 'Pod is pending'
    });
    seenPods.add(podKey);
    return;
  }

  if (pod.status === 'Failed') {
    issues.push({
      podName: pod.name,
      namespace: pod.namespace,
      reason: 'Failed',
      severity: 'critical'
    });
    seenPods.add(podKey);
  }
}

function checkEventIssues(events: FilteredEvent[], seenPods: Set<string>, issues: TriageIssue[]): void {
  for (const event of events) {
    if (event.involvedObject?.kind !== 'Pod') continue;

    const podKey = `${event.involvedObject.namespace || 'default'}/${event.involvedObject.name}`;
    if (seenPods.has(podKey)) continue;

    const isCritical = CRITICAL_REASONS.includes(event.reason);
    const isWarning = WARNING_EVENT_REASONS.includes(event.reason);

    if (isCritical || isWarning) {
      seenPods.add(podKey);
      issues.push({
        podName: event.involvedObject.name,
        namespace: event.involvedObject.namespace || 'default',
        reason: event.reason,
        severity: isCritical ? 'critical' : 'warning',
        message: event.message
      });
    }
  }
}

export function extractTriageIssues(pods: FilteredPod[], events: FilteredEvent[]): TriageIssue[] {
  const issues: TriageIssue[] = [];
  const seenPods = new Set<string>();

  for (const pod of pods) {
    const podKey = `${pod.namespace}/${pod.name}`;
    checkContainerIssues(pod, podKey, seenPods, issues);
    checkPodStatusIssues(pod, podKey, seenPods, issues);
  }

  checkEventIssues(events, seenPods, issues);

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

// Enrich triage issues with resolved owner info from pod ownerReferences
function enrichIssuesWithOwners(issues: TriageIssue[], pods: FilteredPod[], ownerMap: OwnerMap): void {
  for (const issue of issues) {
    const pod = pods.find(p => p.name === issue.podName);
    const resolved = resolveOwner(pod?.ownerReferences, ownerMap);
    if (resolved) {
      issue.ownerKind = resolved.kind;
      issue.ownerName = resolved.name;
    }
  }
}

export function analyzeTriageData(
  data: TriageData,
  ownerMap: OwnerMap = new Map()
): { triageResult: TriageResult; needsDeepDive: boolean } {
  const issues = extractTriageIssues(data.pods, data.events);

  // Enrich issues with resolved owner workload
  enrichIssuesWithOwners(issues, data.pods, ownerMap);

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
    eventsSummary
  };

  // Need deep dive if there are any critical issues or warnings
  const needsDeepDive = issues.some(i => i.severity === 'critical') || issues.length > 0;

  return { triageResult, needsDeepDive };
}

// The actual node function for LangGraph
export async function triageNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const namespace = state.namespace;

  // Use the tools to gather data, fetch owner references in parallel
  const [podsResult, nodesResult, eventsResult, ownerMap] = await Promise.all([
    listPodsTool.invoke({ namespace }),
    listNodesTool.invoke({}),
    listEventsTool.invoke({ namespace }),
    buildOwnerMap(namespace)
  ]);

  // Parse results — track which API calls failed
  const errors: string[] = [];
  let pods: FilteredPod[] = [];
  let nodes: FilteredNode[] = [];
  let events: FilteredEvent[] = [];

  try {
    pods = JSON.parse(podsResult as string);
  } catch {
    errors.push(`Pods: ${podsResult}`);
  }

  try {
    nodes = JSON.parse(nodesResult as string);
  } catch {
    errors.push(`Nodes: ${nodesResult}`);
  }

  try {
    events = JSON.parse(eventsResult as string);
  } catch {
    errors.push(`Events: ${eventsResult}`);
  }

  // If all API calls failed, the cluster is unreachable
  if (errors.length === 3) {
    logger.error('Cluster unreachable — all API calls failed');
    const triageResult: TriageResult = {
      issues: [
        {
          podName: 'N/A',
          namespace,
          reason: 'ClusterUnreachable',
          severity: 'critical',
          message: `Could not connect to cluster. Errors:\n${errors.join('\n')}`
        }
      ],
      healthyPods: [],
      nodeStatus: 'critical',
      eventsSummary: errors
    };
    return { triageResult, needsDeepDive: false };
  }

  // Log partial failures as warnings
  for (const error of errors) {
    logger.warn(`Partial API failure: ${error}`);
  }

  const { triageResult, needsDeepDive } = analyzeTriageData({ pods, nodes, events }, ownerMap);

  return {
    triageResult,
    needsDeepDive
  };
}
