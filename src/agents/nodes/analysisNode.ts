import { getLogger } from '@fluidware-it/saddlebag';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { getChatModel } from '../modelProvider';
import { describeResourceTool, getWorkloadSpecTool, listConfigsAndSecretsTool } from '../../tools/investigationTools';
import { readPodLogsTool, getPodMetricsTool } from '../../tools/deepDiveTools';
import { listEventsTool } from '../../tools/triageTools';
import type { DiagnosticStateType } from '../state';

const logger = getLogger();

const DEFAULT_MAX_ITERATIONS = 3;

// Tools available to the hybrid analysis agent for follow-up investigation
const INVESTIGATION_TOOLS = [
  describeResourceTool,
  getWorkloadSpecTool,
  listConfigsAndSecretsTool,
  readPodLogsTool,
  getPodMetricsTool,
  listEventsTool
];

const SYSTEM_PROMPT = `You are a Kubernetes diagnostic expert with access to investigation tools.
You receive triage data and pod logs from a cluster namespace.

Use the tools only when the provided data is insufficient to diagnose an issue. Prefer concise analysis.
For each issue (or group of related pods), provide:
1. **Root cause** — a concise hypothesis based on the evidence
2. **Remediation** — concrete, actionable steps with exact kubectl commands
3. **Priority** — what to fix first and why

Rules:
- Be concise. No filler.
- Base your analysis on actual data.
- If no logs are available for an issue, consider using read_pod_logs or describe_resource.
- Group related pods (same deployment/job) together in your analysis.`;

function getMaxIterations(): number {
  // eslint-disable-next-line n/no-process-env
  const env = process.env.ANALYSIS_MAX_ITERATIONS;
  if (!env) return DEFAULT_MAX_ITERATIONS;
  const parsed = parseInt(env, 10);
  return isNaN(parsed) || parsed < 0 ? DEFAULT_MAX_ITERATIONS : parsed;
}

// Build a concise prompt with triage results and deep-dive findings
function buildAnalysisPrompt(state: DiagnosticStateType): string {
  const { namespace, triageResult, deepDiveFindings } = state;
  const lines: string[] = [];

  lines.push(`Namespace: ${namespace}`);
  lines.push('');

  // Triage issues — grouped by owner workload when available
  if (triageResult && triageResult.issues.length > 0) {
    lines.push('## Issues Found');

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

function extractContent(message: any): string {
  return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
}

async function runWithReactAgent(state: DiagnosticStateType, maxIterations: number): Promise<string> {
  const agent = createReactAgent({
    llm: getChatModel(),
    tools: INVESTIGATION_TOOLS,
    prompt: SYSTEM_PROMPT
  });

  // Each iteration = agent node + tools node = 2 steps; +1 for the final answer step
  const recursionLimit = maxIterations * 2 + 1;
  const result = await agent.invoke({ messages: [new HumanMessage(buildAnalysisPrompt(state))] }, { recursionLimit });

  return extractContent(result.messages[result.messages.length - 1]);
}

async function runWithSingleInvoke(state: DiagnosticStateType): Promise<string> {
  const response = await getChatModel().invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(buildAnalysisPrompt(state))
  ]);
  return extractContent(response);
}

export async function analysisNode(state: DiagnosticStateType): Promise<Partial<DiagnosticStateType>> {
  const triageResult = state.triageResult;

  // Skip analysis if no issues found
  if (!triageResult || triageResult.issues.length === 0) {
    return { llmAnalysis: '' };
  }

  logger.info('Running LLM analysis on diagnostic findings');

  try {
    const maxIterations = getMaxIterations();
    const analysis =
      maxIterations === 0 ? await runWithSingleInvoke(state) : await runWithReactAgent(state, maxIterations);

    logger.info('LLM analysis complete');
    return { llmAnalysis: analysis };
  } catch (error) {
    logger.error(`LLM analysis failed: ${error}`);
    // Graceful fallback — the report still works without LLM analysis
    return { llmAnalysis: '' };
  }
}
