import { getLogger } from '@fluidware-it/saddlebag';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getChatModel } from '../modelProvider';
import type { DiagnosticStateType } from '../state';

const logger = getLogger();

// Build a concise prompt with triage results and deep-dive findings
function buildAnalysisPrompt(state: DiagnosticStateType): string {
  const { namespace, triageResult, deepDiveFindings } = state;
  const lines: string[] = [];

  lines.push(`Namespace: ${namespace}`);
  lines.push('');

  // Triage issues — grouped by owner workload when available
  if (triageResult && triageResult.issues.length > 0) {
    lines.push('## Issues Found');

    // Group issues by owner so the LLM sees workload-level context
    const groups = new Map<string, typeof triageResult.issues>();
    for (const issue of triageResult.issues) {
      const key = issue.ownerKind && issue.ownerName ? `${issue.ownerKind}/${issue.ownerName}` : `Pod/${issue.podName}`;
      const group = groups.get(key);
      if (group) {
        group.push(issue);
      } else {
        groups.set(key, [issue]);
      }
    }

    for (const [workload, issues] of groups) {
      const reasons = [...new Set(issues.map(i => i.reason))].join(', ');
      const maxRestarts = Math.max(...issues.map(i => i.restarts ?? 0));
      const restarts = maxRestarts > 0 ? ` (max restarts: ${maxRestarts})` : '';
      const pods = issues.map(i => i.podName).join(', ');
      const severity = issues[0]!.severity;
      lines.push(`- [${severity}] ${workload}: ${reasons} (pods: ${pods})${restarts}`);
    }
    lines.push('');
  }

  // Deep-dive findings (logs and metrics)
  if (deepDiveFindings.length > 0) {
    lines.push('## Deep-Dive Findings');
    lines.push(deepDiveFindings.join('\n---\n'));
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a Kubernetes diagnostic expert. You receive triage data and pod logs from a cluster namespace.

For each issue (or group of related pods), provide:
1. **Root cause** — a concise hypothesis based on the evidence
2. **Remediation** — concrete, actionable steps with exact kubectl commands
3. **Priority** — what to fix first and why

Rules:
- Be concise. No filler.
- Base your analysis on the actual logs and data provided.
- If no logs are available for an issue, say so and give your best hypothesis.
- Group related pods (same deployment/job) together in your analysis.`;

export async function analysisNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const triageResult = state.triageResult;

  // Skip analysis if no issues found
  if (!triageResult || triageResult.issues.length === 0) {
    return { llmAnalysis: '' };
  }

  logger.info('Running LLM analysis on diagnostic findings');

  try {
    const model = getChatModel();
    const userPrompt = buildAnalysisPrompt(state);

    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userPrompt)]);

    const analysis = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    logger.info('LLM analysis complete');
    return { llmAnalysis: analysis };
  } catch (error) {
    logger.error(`LLM analysis failed: ${error}`);
    // Graceful fallback — the report still works without LLM analysis
    return { llmAnalysis: '' };
  }
}
