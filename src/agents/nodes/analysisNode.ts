import { getLogger } from '@fluidware-it/saddlebag';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { getChatModel } from '../modelProvider';
import { describeResourceTool, getWorkloadSpecTool, listConfigsAndSecretsTool } from '../../tools/investigationTools';
import { correlatePodTimestamps } from '../../utils/timestampCorrelator';
import { readPodLogsTool, getPodMetricsTool } from '../../tools/deepDiveTools';
import { listEventsTool } from '../../tools/triageTools';
import type { DiagnosticStateType } from '../state';
import type { TriageIssue } from '../../types/triage';

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

export const SYSTEM_PROMPT = `You are a Kubernetes diagnostic expert with access to investigation tools.
You receive triage data and pod logs from a cluster namespace.

Use the tools only when the provided data is insufficient to diagnose an issue. Prefer concise analysis.
For each issue (or group of related pods), provide:
1. **Root cause** — a concise hypothesis based on the evidence
2. **Remediation** — concrete, actionable steps with exact kubectl commands
3. **Priority** — what to fix first and why

Rules:
- Be concise. No filler.
- Base your analysis on actual data.
- Use at most 2-3 tool calls total, then produce your final analysis immediately. Do not loop.
- If no logs are available for an issue, consider using read_pod_logs or describe_resource.
- Group related pods (same deployment/job) together in your analysis.
- For OOMKilled or HighRestartCount issues, always call both get_workload_spec (to read memory limits) and get_pod_metrics (to read actual usage), then compare limits against usage.
- Tag each hypothesis with one of: [direct evidence] (log/metric confirms it), [inferred] (pattern matches but not directly observed), or [speculative — no logs] (no logs available for this pod/container).
- After calling tools, you MUST write your final analysis text. Never call a tool as your last action.`;

function getMaxIterations(): number {
  // eslint-disable-next-line n/no-process-env
  const env = process.env.ANALYSIS_MAX_ITERATIONS;
  if (!env) return DEFAULT_MAX_ITERATIONS;
  const parsed = parseInt(env, 10);
  return isNaN(parsed) || parsed < 0 ? DEFAULT_MAX_ITERATIONS : parsed;
}

// Group triage issues by owner workload key (e.g. "Deployment/name" or "Pod/name")
function groupIssuesByOwner(issues: TriageIssue[]): Map<string, TriageIssue[]> {
  const groups = new Map<string, TriageIssue[]>();
  for (const issue of issues) {
    const key = issue.ownerKind && issue.ownerName ? `${issue.ownerKind}/${issue.ownerName}` : `Pod/${issue.podName}`;
    const group = groups.get(key);
    if (group) {
      group.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }
  return groups;
}

// Include node status when degraded — helps correlate pod OOMKills with node memory pressure
function buildNodeStatusLines(triageResult: DiagnosticStateType['triageResult']): string[] {
  if (triageResult && triageResult.nodeStatus !== 'healthy') {
    return [`Node status: ${triageResult.nodeStatus}`, ''];
  }
  return [''];
}

// Triage issues — grouped by owner workload when available
function buildIssuesSection(triageResult: DiagnosticStateType['triageResult']): string[] {
  if (!triageResult || triageResult.issues.length === 0) return [];

  const lines: string[] = ['## Issues Found'];
  const groups = groupIssuesByOwner(triageResult.issues);
  for (const [workload, issues] of groups) {
    const reasons = [...new Set(issues.map(i => i.reason))].join(', ');
    const maxRestarts = Math.max(...issues.map(i => i.restarts ?? 0));
    const restarts = maxRestarts > 0 ? ` (max restarts: ${maxRestarts})` : '';
    const pods = issues.map(i => i.podName).join(', ');
    const severity = issues[0]!.severity;
    lines.push(`- [${severity}] ${workload}: ${reasons} (pods: ${pods})${restarts}`);
  }
  lines.push('');
  return lines;
}

// Cross-pod timestamp correlation
function buildCorrelationsSection(triageResult: DiagnosticStateType['triageResult']): string[] {
  if (!triageResult || triageResult.issues.length <= 1 || triageResult.eventsSummary.length === 0) return [];

  const correlationNotes = correlatePodTimestamps(triageResult.issues, triageResult.eventsSummary);
  if (correlationNotes.length === 0) return [];

  const lines: string[] = ['## Timing Correlations'];
  for (const n of correlationNotes) {
    lines.push(`- ${n.workload}: ${n.note}`);
  }
  lines.push('');
  return lines;
}

// Namespace ResourceQuota and LimitRange constraints
function buildConstraintsSection(namespaceConstraints: DiagnosticStateType['namespaceConstraints']): string[] {
  if (!namespaceConstraints) return [];

  const { resourceQuotas, limitRanges } = namespaceConstraints;
  if (resourceQuotas.length === 0 && limitRanges.length === 0) return [];

  const lines: string[] = ['## Namespace Constraints'];
  for (const rq of resourceQuotas) {
    lines.push(`- ResourceQuota/${rq.name}: hard=${JSON.stringify(rq.hard)}, used=${JSON.stringify(rq.used)}`);
  }
  for (const lr of limitRanges) {
    lines.push(`- LimitRange/${lr.name}: ${JSON.stringify(lr.limits)}`);
  }
  lines.push('');
  return lines;
}

// Service dependency hints
function buildDependencySection(dependencyHints: DiagnosticStateType['dependencyHints']): string[] {
  if (dependencyHints.length === 0) return [];

  const lines: string[] = ['## Dependency Hints'];
  for (const h of dependencyHints) {
    lines.push(`- ${h.workload}: ${h.hint}`);
  }
  lines.push('');
  return lines;
}

// Deep-dive findings (logs and metrics)
function buildDeepDiveSection(deepDiveFindings: DiagnosticStateType['deepDiveFindings']): string[] {
  if (deepDiveFindings.length === 0) return [];
  return ['## Deep-Dive Findings', deepDiveFindings.join('\n---\n')];
}

// Build a concise prompt with triage results and deep-dive findings
function buildAnalysisPrompt(state: DiagnosticStateType): string {
  const { namespace, triageResult, deepDiveFindings, namespaceConstraints, dependencyHints } = state;
  const lines: string[] = [];

  lines.push(`Namespace: ${namespace}`);
  lines.push(...buildNodeStatusLines(triageResult));
  lines.push(...buildIssuesSection(triageResult));
  lines.push(...buildCorrelationsSection(triageResult));
  lines.push(...buildConstraintsSection(namespaceConstraints));
  lines.push(...buildDependencySection(dependencyHints));
  lines.push(...buildDeepDiveSection(deepDiveFindings));

  return lines.join('\n');
}

function extractContent(message: any): string {
  return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
}

const EVIDENCE_SUMMARY_PROMPT = `You are a Kubernetes log analyst. For each issue group below, produce a concise evidence summary:
- Confirmed: what logs/metrics directly show
- Missing: what information is absent
- Ambiguous: what could be interpreted multiple ways

Be terse. Format per group:
### <Workload>: <Reason>
- Confirmed: ...
- Missing: ...
- Ambiguous: ...`;

async function runEvidenceSummary(prompt: string): Promise<string> {
  const response = await getChatModel().invoke([new SystemMessage(EVIDENCE_SUMMARY_PROMPT), new HumanMessage(prompt)]);
  return extractContent(response);
}

async function runWithReactAgent(prompt: string, maxIterations: number, evidenceSummary?: string): Promise<string> {
  const agent = createReactAgent({
    llm: getChatModel(),
    tools: INVESTIGATION_TOOLS,
    prompt: SYSTEM_PROMPT
  });

  // Each iteration = agent node + tools node = 2 steps; +1 for the final answer step
  const recursionLimit = maxIterations * 2 + 1;
  const promptContent = evidenceSummary ? `${prompt}\n\n## Evidence Summary (Stage 1)\n${evidenceSummary}` : prompt;

  const result = await agent.invoke({ messages: [new HumanMessage(promptContent)] }, { recursionLimit });

  return extractContent(result.messages[result.messages.length - 1]);
}

async function runTwoStageAnalysis(prompt: string, maxIterations: number): Promise<string> {
  const evidenceSummary = await runEvidenceSummary(prompt);
  try {
    return await runWithReactAgent(prompt, maxIterations, evidenceSummary);
  } catch (error) {
    if (isRecursionError(error)) {
      // The agent exhausted its tool-call budget without producing a final answer.
      // Fall back to a single LLM invoke with all gathered context (stage 1 + triage data).
      logger.warn('ReAct agent hit recursion limit — falling back to single invoke with stage 1 context');
      return runWithSingleInvoke(prompt, evidenceSummary);
    }
    throw error;
  }
}

async function runWithSingleInvoke(prompt: string, extraContext?: string): Promise<string> {
  const promptContent = extraContext ? `${prompt}\n\n## Evidence Summary (Stage 1)\n${extraContext}` : prompt;
  const response = await getChatModel().invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(promptContent)]);
  return extractContent(response);
}

function isRecursionError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'GraphRecursionError' || error.message.includes('Recursion limit'));
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
    const prompt = buildAnalysisPrompt(state);
    const analysis =
      maxIterations === 0 ? await runWithSingleInvoke(prompt) : await runTwoStageAnalysis(prompt, maxIterations);

    logger.info('LLM analysis complete');
    return { llmAnalysis: analysis };
  } catch (error) {
    logger.error(`LLM analysis failed: ${error}`);
    // Graceful fallback — the report still works without LLM analysis
    return { llmAnalysis: '' };
  }
}
