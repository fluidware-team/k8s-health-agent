import { readPodLogsTool, getPodMetricsTool } from '../../tools/deepDiveTools';
import { preprocessLogs } from '../../utils/logPreprocessor';
import type { TriageIssue, DiagnosticStateType } from '../state';
import { getLogger } from '@fluidware-it/saddlebag';

const logger = getLogger();

// Reasons that benefit from reading previous (pre-crash) logs
const PREVIOUS_LOG_REASONS = ['CrashLoopBackOff', 'OOMKilled'];
// Reasons that benefit from resource usage metrics
const METRICS_REASONS = ['OOMKilled', 'HighRestartCount'];
const MAX_ISSUES_TO_INVESTIGATE = 5;
const DEEP_DIVE_TAIL_LINES = 50;

// Format metrics into a markdown section, or empty string if unavailable
function formatMetricsSection(metricsResult: string | null): string {
  if (!metricsResult || metricsResult.includes('Error')) {
    return '';
  }
  try {
    const metrics = JSON.parse(metricsResult);
    if (metrics.length === 0) return '';
    const podMetrics = metrics[0];
    const lines = podMetrics.containers.map(
      (c: any) => `- **${c.name}**: CPU: ${c.usage.cpu}, Memory: ${c.usage.memory}`
    );
    return `\n### Current Resource Usage:\n${lines.join('\n')}\n`;
  } catch {
    return '';
  }
}

// Investigate a single issue by reading pod logs and metrics
async function investigateIssue(issue: TriageIssue, namespace: string): Promise<string> {
  try {
    const previous = PREVIOUS_LOG_REASONS.includes(issue.reason);

    // Get logs and metrics in parallel
    const [logs, metricsResult] = await Promise.all([
      readPodLogsTool.invoke({
        podName: issue.podName,
        namespace: issue.namespace,
        containerName: issue.containerName,
        previous,
        tailLines: DEEP_DIVE_TAIL_LINES
      }),
      METRICS_REASONS.includes(issue.reason)
        ? getPodMetricsTool.invoke({ namespace, podName: issue.podName })
        : Promise.resolve(null)
    ]);

    const metricsSection = formatMetricsSection(metricsResult as string | null);
    const processedLogs = preprocessLogs(logs as string);

    return `
## Investigation: ${issue.podName}
**Reason:** ${issue.reason}
**Container:** ${issue.containerName || 'no-container'}
**Previous logs:** ${previous}
${metricsSection}
### Logs:
\`\`\`
${processedLogs}
\`\`\`
`;
  } catch (error: any) {
    const msg = error?.message || String(error);
    logger.error(`Failed to investigate issue for pod ${issue.podName}: ${msg}`);
    return `Investigation failed for ${issue.podName}: ${msg}`;
  }
}

// The actual node function for LangGraph
export async function deepDiveNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const { triageResult, namespace } = state;

  if (!triageResult?.issues?.length) {
    return { deepDiveFindings: [] };
  }

  // Investigate critical issues first, then warnings
  const criticalIssues = triageResult.issues.filter(i => i.severity === 'critical');
  const warningIssues = triageResult.issues.filter(i => i.severity === 'warning');

  // Sort by priority and limit to avoid too many API calls
  const issuesToInvestigate = [...criticalIssues, ...warningIssues].slice(0, MAX_ISSUES_TO_INVESTIGATE);

  logger.info(`Deep dive investigating ${issuesToInvestigate.length} issues`);

  // Investigate in parallel
  const findings = await Promise.all(issuesToInvestigate.map(issue => investigateIssue(issue, namespace)));

  return {
    deepDiveFindings: findings
  };
}
