import type { TriageIssue, TriageResult, DiagnosticStateType } from '../state';
import { IssueSeverity, type DiagnosticIssue, type DiagnosticReport, type HealthyResource } from '../../types/report';
import { formatReport } from '../../utils/reportFormatter';

export interface SummaryInput {
  namespace: string;
  triageResult: TriageResult;
  deepDiveFindings: string[];
}

// Map triage severity to report severity
function mapSeverity(severity: 'critical' | 'warning'): IssueSeverity {
  return severity === 'critical' ? IssueSeverity.CRITICAL : IssueSeverity.WARNING;
}

// Generate suggested kubectl commands based on the issue type
function getSuggestedCommands(issue: TriageIssue): string[] {
  const commands: string[] = [];
  const { podName, namespace, containerName, reason } = issue;
  const container = containerName || 'main';

  // Always suggest describe
  commands.push(`kubectl describe pod ${podName} -n ${namespace}`);

  // Log commands based on issue type
  if (['CrashLoopBackOff', 'OOMKilled'].includes(reason)) {
    commands.push(`kubectl logs ${podName} -n ${namespace} -c ${container} --previous`);
  }
  commands.push(`kubectl logs ${podName} -n ${namespace} -c ${container} --tail=100`);

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
      'Review resource limits (CPU/memory)',
    ],
    OOMKilled: [
      'Increase memory limits in pod specification',
      'Check for memory leaks in the application',
      'Profile memory usage under load',
      'Consider horizontal scaling instead of vertical',
    ],
    FailedMount: [
      'Verify the secret/configmap exists in the namespace',
      'Check RBAC permissions for the service account',
      'Verify PVC is bound and available',
    ],
    ImagePullBackOff: [
      'Verify image name and tag are correct',
      'Check image registry credentials',
      'Verify network access to container registry',
    ],
    Pending: [
      'Check node resource availability',
      'Review node selectors and taints/tolerations',
      'Check PVC binding status',
    ],
    HighRestartCount: [
      'Review recent changes to the deployment',
      'Check for liveness probe failures',
      'Monitor application health metrics',
    ],
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

export function buildDiagnosticReport(input: SummaryInput): DiagnosticReport {
  const { namespace, triageResult, deepDiveFindings } = input;
  const timestamp = new Date().toISOString();

  // Build summary
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

  // Convert triage issues to diagnostic issues
  const issues: DiagnosticIssue[] = triageResult.issues.map(issue => {
    const findings = findingsForPod(issue.podName, deepDiveFindings);
    let description = `Pod "${issue.podName}" `;

    if (issue.reason === 'HighRestartCount') {
      description += `has ${issue.restarts} restarts.`;
    } else if (issue.message) {
      description += `${issue.reason}: ${issue.message}`;
    } else {
      description += `is in ${issue.reason} state.`;
    }

    if (findings) {
      description += `\n\n**Log analysis:**\n${findings}`;
    }

    return {
      severity: mapSeverity(issue.severity),
      title: `${issue.reason}: ${issue.podName}`,
      description,
      resource: {
        kind: 'Pod',
        name: issue.podName,
        namespace: issue.namespace,
      },
      suggestedCommands: getSuggestedCommands(issue),
      nextSteps: getNextSteps(issue),
    };
  });

  // Build healthy resources list
  const healthyResources: HealthyResource[] = triageResult.healthyPods.map(podName => ({
    kind: 'Pod',
    name: podName,
    status: 'Running',
  }));

  return {
    namespace,
    timestamp,
    summary,
    issues,
    healthyResources,
  };
}

// The actual node function for LangGraph
export async function summaryNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const report = buildDiagnosticReport({
    namespace: state.namespace,
    triageResult: state.triageResult!,
    deepDiveFindings: state.deepDiveFindings,
  });

  // Format the report as markdown
  const formattedReport = formatReport(report);

  // Log the formatted report
  console.log(formattedReport);

  return {
    issues: report.issues,
    healthyResources: report.healthyResources,
  };
}
