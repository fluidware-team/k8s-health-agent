import type { TriageIssue, DiagnosticStateType } from '../state';
import { IssueSeverity, type DiagnosticIssue, type DiagnosticReport, type HealthyResource } from '../../types/report';
import type { SummaryInput } from '../../types/summary';
import { formatReport } from '../../utils/reportFormatter';

export type { SummaryInput };

// Map triage severity to report severity
function mapSeverity(severity: 'critical' | 'warning' | 'info'): IssueSeverity {
  if (severity === 'critical') return IssueSeverity.CRITICAL;
  if (severity === 'info') return IssueSeverity.INFO;
  return IssueSeverity.WARNING;
}

// Generate suggested kubectl commands based on the issue type
function getSuggestedCommands(issue: TriageIssue): string[] {
  const commands: string[] = [];
  const { podName, namespace, containerName, reason } = issue;

  if (reason === 'ClusterUnreachable') {
    commands.push('kubectl cluster-info');
    commands.push('kubectl get nodes');
    return commands;
  }

  const container = containerName;
  const containerArgString = container ? ` -c ${container}` : '';

  // Always suggest describe
  commands.push(`kubectl describe pod ${podName} -n ${namespace}`);

  // Log commands based on issue type
  if (['CrashLoopBackOff', 'OOMKilled'].includes(reason)) {
    commands.push(`kubectl logs ${podName} -n ${namespace}${containerArgString} --previous`);
  }
  commands.push(`kubectl logs ${podName} -n ${namespace}${containerArgString} --tail=100`);

  // Additional commands based on reason
  if (reason === 'OOMKilled') {
    commands.push(`kubectl top pod ${podName} -n ${namespace}`);
    commands.push(`kubectl get pod ${podName} -n ${namespace} -o jsonpath='{.spec.containers[*].resources}'`);
  }

  if (reason === 'FailedMount') {
    commands.push(`kubectl get secrets -n ${namespace}`);
    commands.push(`kubectl get configmaps -n ${namespace}`);
    commands.push(`kubectl get pvc -n ${namespace}`);
  }

  if (reason === 'Pending' || reason === 'FailedScheduling') {
    commands.push(`kubectl get events -n ${namespace} --field-selector involvedObject.name=${podName}`);
    commands.push(`kubectl get nodes -o wide`);
  }

  if (reason === 'HighRestartCount') {
    commands.push(`kubectl rollout restart deployment -n ${namespace}`);
  }

  return commands;
}

// Get next steps based on issue type
function getNextSteps(issue: TriageIssue): string[] {
  const { reason } = issue;

  const nextSteps: Record<string, string[]> = {
    CrashLoopBackOff: [
      'Check application logs for startup errors',
      'Verify environment variables and configuration',
      'Check if required services/dependencies are available',
      'Review resource limits (CPU/memory)'
    ],
    OOMKilled: [
      'Increase memory limits in pod specification',
      'Check for memory leaks in the application',
      'Profile memory usage under load',
      'Consider horizontal scaling instead of vertical'
    ],
    FailedMount: [
      'Verify the secret/configmap exists in the namespace',
      'Check RBAC permissions for the service account',
      'Verify PVC is bound and available'
    ],
    ImagePullBackOff: [
      'Verify image name and tag are correct',
      'Check image registry credentials',
      'Verify network access to container registry'
    ],
    Pending: [
      'Check node resource availability',
      'Review node selectors and taints/tolerations',
      'Check PVC binding status'
    ],
    HighRestartCount: [
      'Review recent changes to the deployment',
      'Check for liveness probe failures',
      'Monitor application health metrics'
    ],
    ClusterUnreachable: [
      'Check your kubeconfig and current context',
      'Verify VPN or network connectivity to the cluster',
      'Check if the cluster API server is running'
    ]
  };

  return nextSteps[reason] || ['Review pod events and logs for more details'];
}

// Extract relevant findings for a specific pod
function findingsForPod(podName: string, findings: string[]): string {
  const relevantFinding = findings.find(f => f.includes(podName));
  if (!relevantFinding) return '';

  // Extract the key information from the finding
  const lines = relevantFinding.split('\n');
  const logsSection = lines.slice(lines.findIndex(l => l.includes('Logs:')) + 1);
  return logsSection.join('\n').replace(/```/g, '').trim();
}

// Build a group key for each issue based on its owner workload and reason.
// Pods without an owner are keyed individually.
function issueGroupKey(issue: TriageIssue): string {
  if (issue.ownerKind && issue.ownerName) {
    return `${issue.ownerKind}/${issue.ownerName}/${issue.reason}`;
  }
  return `Pod/${issue.podName}/${issue.reason}`;
}

// Build a human-readable description for a single (ungrouped) issue.
function buildSingleIssueDescription(issue: TriageIssue): string {
  let description = `Pod "${issue.podName}" `;
  if (issue.reason === 'HighRestartCount') {
    description += `has ${issue.restarts} restarts.`;
  } else if (issue.message) {
    description += `${issue.reason}: ${issue.message}`;
  } else {
    description += `is in ${issue.reason} state.`;
  }
  return description;
}

// Convert a group of triage issues (same owner + reason) into one DiagnosticIssue.
function convertGroupToIssue(group: TriageIssue[], deepDiveFindings: string[]): DiagnosticIssue {
  const first = group[0]!;
  const isGrouped = group.length > 1;
  const hasOwner = first.ownerKind && first.ownerName;

  const resourceKind = hasOwner ? first.ownerKind! : 'Pod';
  const resourceName = hasOwner ? first.ownerName! : first.podName;
  const resourceLabel = `${resourceKind}/${resourceName}`;

  const title = isGrouped
    ? `${first.reason}: ${resourceLabel} (${group.length} pods)`
    : `${first.reason}: ${hasOwner ? resourceLabel : first.podName}`;

  let description = isGrouped
    ? `${group.length} pods in ${first.reason} state: ${group.map(i => i.podName).join(', ')}.`
    : buildSingleIssueDescription(first);

  // Aggregate deep-dive findings for all pods in the group
  const allFindings = group.map(i => findingsForPod(i.podName, deepDiveFindings)).filter(Boolean);
  if (allFindings.length > 0) {
    description += `\n\n**Log analysis:**\n${allFindings.join('\n\n')}`;
  }

  return {
    severity: mapSeverity(first.severity),
    title,
    description,
    resource: { kind: resourceKind, name: resourceName, namespace: first.namespace },
    affectedPods: isGrouped ? group.map(i => i.podName) : undefined,
    suggestedCommands: getSuggestedCommands(first),
    nextSteps: getNextSteps(first)
  };
}

// Group triage issues that share the same workload owner and reason,
// producing one DiagnosticIssue per group.
export function groupIssuesByWorkload(issues: TriageIssue[], deepDiveFindings: string[]): DiagnosticIssue[] {
  // Collect issues into groups while preserving insertion order
  const groups = new Map<string, TriageIssue[]>();
  for (const issue of issues) {
    const key = issueGroupKey(issue);
    const group = groups.get(key);
    if (group) {
      group.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }

  return [...groups.values()].map(group => convertGroupToIssue(group, deepDiveFindings));
}

export function buildDiagnosticReport(input: SummaryInput): DiagnosticReport {
  const { namespace, triageResult, deepDiveFindings, llmAnalysis } = input;
  const timestamp = new Date().toISOString();

  // Build summary — count individual pods, not groups
  let summary = '';
  if (triageResult.issues.length === 0) {
    summary = `Namespace "${namespace}" is healthy. `;
    if (triageResult.healthyPods.length > 0) {
      summary += `${triageResult.healthyPods.length} pods running normally.`;
    }
  } else {
    const criticalCount = triageResult.issues.filter(i => i.severity === 'critical').length;
    const warningCount = triageResult.issues.filter(i => i.severity === 'warning').length;
    summary = `Found ${criticalCount} critical issue(s) and ${warningCount} warning(s) in namespace "${namespace}".`;
  }

  if (triageResult.nodeStatus !== 'healthy') {
    summary += ` Node status: ${triageResult.nodeStatus}.`;
  }

  // Group triage issues by workload owner and convert to diagnostic issues
  const issues = groupIssuesByWorkload(triageResult.issues, deepDiveFindings);

  // Build healthy resources list
  const healthyResources: HealthyResource[] = triageResult.healthyPods.map(podName => ({
    kind: 'Pod',
    name: podName,
    status: 'Running'
  }));

  return {
    namespace,
    timestamp,
    summary,
    issues,
    healthyResources,
    llmAnalysis: llmAnalysis || undefined
  };
}

// The actual node function for LangGraph
export async function summaryNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const report = buildDiagnosticReport({
    namespace: state.namespace,
    triageResult: state.triageResult!,
    deepDiveFindings: state.deepDiveFindings,
    llmAnalysis: state.llmAnalysis
  });

  // Format the report as markdown
  const formattedReport = formatReport(report);

  // Log the formatted report
  // eslint-disable-next-line no-console
  console.log(formattedReport);

  return {
    issues: report.issues,
    healthyResources: report.healthyResources
  };
}
