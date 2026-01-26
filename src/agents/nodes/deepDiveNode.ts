import { readPodLogsTool } from '../../tools/deepDiveTools';
import type { TriageIssue, DiagnosticStateType } from '../state';
import { getLogger } from '@fluidware-it/saddlebag';

const logger = getLogger();

// Investigate a single issue by reading pod logs
async function investigateIssue(issue: TriageIssue): Promise<string> {
  try {
    // For CrashLoopBackOff, try to get previous logs
    const previous = ['CrashLoopBackOff', 'OOMKilled'].includes(issue.reason);

    const logs = await readPodLogsTool.invoke({
      podName: issue.podName,
      namespace: issue.namespace,
      containerName: issue.containerName || 'main',
      previous,
      tailLines: 50,
    });

    return `
## Investigation: ${issue.podName}
**Reason:** ${issue.reason}
**Container:** ${issue.containerName || 'main'}
**Previous logs:** ${previous}

### Logs:
\`\`\`
${logs}
\`\`\`
`;
  } catch (error) {
    logger.error(`Failed to investigate issue for pod ${issue.podName}: ${error}`);
    return `Failed to get logs for ${issue.podName}: ${error}`;
  }
}

// The actual node function for LangGraph
export async function deepDiveNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const triageResult = state.triageResult;

  if (!triageResult || triageResult.issues.length === 0) {
    return { deepDiveFindings: [] };
  }

  // Investigate critical issues first, then warnings
  const criticalIssues = triageResult.issues.filter(i => i.severity === 'critical');
  const warningIssues = triageResult.issues.filter(i => i.severity === 'warning');

  // Sort by priority and limit to avoid too many API calls
  const issuesToInvestigate = [...criticalIssues, ...warningIssues].slice(0, 5);

  logger.info(`Deep dive investigating ${issuesToInvestigate.length} issues`);

  // Investigate in parallel but with concurrency limit
  const findings = await Promise.all(issuesToInvestigate.map(issue => investigateIssue(issue)));

  return {
    deepDiveFindings: findings,
  };
}
