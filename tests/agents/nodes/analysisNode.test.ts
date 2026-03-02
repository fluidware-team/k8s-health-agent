import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available inside vi.mock factory (which is hoisted to top of file)
const { mockAgentInvoke, mockModelInvoke } = vi.hoisted(() => ({
  mockAgentInvoke: vi.fn(),
  mockModelInvoke: vi.fn()
}));

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn().mockReturnValue({ invoke: mockAgentInvoke })
}));

vi.mock('../../../src/agents/modelProvider', () => ({
  getChatModel: () => ({ invoke: mockModelInvoke })
}));

import { analysisNode, SYSTEM_PROMPT } from '../../../src/agents/nodes/analysisNode';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { DiagnosticStateType } from '../../../src/agents/state';

function makeState(overrides: Partial<DiagnosticStateType> = {}): DiagnosticStateType {
  return {
    namespace: 'default',
    messages: [],
    triageResult: null,
    namespaceConstraints: null,
    dependencyHints: [],
    deepDiveFindings: [],
    llmAnalysis: '',
    issues: [],
    needsDeepDive: false,
    ...overrides
  };
}

const stateWithIssue = makeState({
  triageResult: {
    issues: [{ podName: 'crash-pod', namespace: 'default', reason: 'CrashLoopBackOff', severity: 'critical' }],
    healthyPods: [],
    nodeStatus: 'healthy',
    eventsSummary: []
  },
  deepDiveFindings: ['## Investigation: crash-pod\nError: Connection refused']
});

describe('analysisNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stage 1 (evidence summary): simple model invoke
    mockModelInvoke.mockResolvedValue({ content: 'Stage 1 evidence summary' });
    // Stage 2: ReAct agent returns final analysis
    mockAgentInvoke.mockResolvedValue({
      messages: [{ content: '**Root cause:** DB connection refused' }]
    });
    vi.unstubAllEnvs();
  });

  it('should skip analysis when no issues found', async () => {
    const state = makeState({
      triageResult: { issues: [], healthyPods: [], nodeStatus: 'healthy', eventsSummary: [] }
    });

    const result = await analysisNode(state);

    expect(result.llmAnalysis).toBe('');
    expect(mockAgentInvoke).not.toHaveBeenCalled();
    expect(mockModelInvoke).not.toHaveBeenCalled();
  });

  it('should skip analysis when triageResult is null', async () => {
    const state = makeState();

    const result = await analysisNode(state);

    expect(result.llmAnalysis).toBe('');
    expect(mockAgentInvoke).not.toHaveBeenCalled();
  });

  it('should use createReactAgent by default and return analysis (two-stage)', async () => {
    const result = await analysisNode(stateWithIssue);

    // Stage 1: evidence summary via model invoke
    expect(mockModelInvoke).toHaveBeenCalledOnce();
    // Stage 2: ReAct agent
    expect(createReactAgent).toHaveBeenCalledOnce();
    expect(mockAgentInvoke).toHaveBeenCalledOnce();
    expect(result.llmAnalysis).toContain('Root cause');
  });

  it('should pass the 6 investigation tools to createReactAgent', async () => {
    await analysisNode(stateWithIssue);

    const { tools } = vi.mocked(createReactAgent).mock.calls[0]![0] as any;
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('describe_resource');
    expect(toolNames).toContain('get_workload_spec');
    expect(toolNames).toContain('list_configmaps_and_secrets');
    expect(toolNames).toContain('read_pod_logs');
    expect(toolNames).toContain('get_pod_metrics');
    expect(toolNames).toContain('list_events');
  });

  it('should apply a recursionLimit derived from ANALYSIS_MAX_ITERATIONS', async () => {
    vi.stubEnv('ANALYSIS_MAX_ITERATIONS', '5');

    await analysisNode(stateWithIssue);

    // maxIterations=5 → recursionLimit = 5*2+1 = 11
    const invokeConfig = mockAgentInvoke.mock.calls[0]![1];
    expect(invokeConfig?.recursionLimit).toBe(11);
  });

  it('should include issues and deep-dive findings in the prompt', async () => {
    const state = makeState({
      triageResult: {
        issues: [{ podName: 'pod-1', namespace: 'ns', reason: 'OOMKilled', severity: 'critical', restarts: 5 }],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      },
      deepDiveFindings: ['## Investigation: pod-1\nMemory usage: 512Mi']
    });

    await analysisNode(state);

    const userMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(userMessage).toContain('pod-1');
    expect(userMessage).toContain('OOMKilled');
    expect(userMessage).toContain('Memory usage: 512Mi');
  });

  it('should group issues by owner workload in the prompt', async () => {
    const state = makeState({
      triageResult: {
        issues: [
          {
            podName: 'gw-aaa',
            namespace: 'ns',
            reason: 'CrashLoopBackOff',
            severity: 'critical',
            ownerKind: 'Deployment',
            ownerName: 'gateway'
          },
          {
            podName: 'gw-bbb',
            namespace: 'ns',
            reason: 'CrashLoopBackOff',
            severity: 'critical',
            ownerKind: 'Deployment',
            ownerName: 'gateway'
          }
        ],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      }
    });

    await analysisNode(state);

    const userMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(userMessage).toContain('Deployment/gateway');
    expect(userMessage).toContain('gw-aaa');
    expect(userMessage).toContain('gw-bbb');
  });

  it('should fall back to single model.invoke when ANALYSIS_MAX_ITERATIONS=0', async () => {
    vi.stubEnv('ANALYSIS_MAX_ITERATIONS', '0');
    // Single-invoke path uses mockModelInvoke only (no stage 1)
    mockModelInvoke.mockResolvedValue({ content: 'Fallback analysis' });

    const result = await analysisNode(stateWithIssue);

    expect(createReactAgent).not.toHaveBeenCalled();
    expect(mockModelInvoke).toHaveBeenCalledOnce();
    expect(result.llmAnalysis).toBe('Fallback analysis');
  });

  it('should return empty analysis when the agent fails with a non-recursion error', async () => {
    mockAgentInvoke.mockRejectedValue(new Error('API error'));

    const result = await analysisNode(stateWithIssue);

    expect(result.llmAnalysis).toBe('');
  });

  it('should fall back to single invoke when the agent hits the recursion limit', async () => {
    const recursionError = new Error('Recursion limit of 7 reached without hitting a stop condition.');
    recursionError.name = 'GraphRecursionError';
    mockAgentInvoke.mockRejectedValue(recursionError);
    // Stage 1 returns evidence summary; fallback single invoke returns final analysis
    mockModelInvoke
      .mockResolvedValueOnce({ content: 'Stage 1 evidence summary' }) // stage 1
      .mockResolvedValueOnce({ content: 'Fallback analysis from single invoke' }); // fallback

    const result = await analysisNode(stateWithIssue);

    expect(result.llmAnalysis).toBe('Fallback analysis from single invoke');
    // Single invoke should receive stage 1 evidence in the prompt
    // calls[1][0] is the messages array; [1] is the HumanMessage (index 1 after SystemMessage)
    const fallbackMessages = mockModelInvoke.mock.calls[1]![0] as any[];
    const humanContent = fallbackMessages[1].content as string;
    expect(humanContent).toContain('Evidence Summary (Stage 1)');
  });

  it('should include node status in prompt when degraded', async () => {
    const state = makeState({
      triageResult: {
        issues: [{ podName: 'pod-1', namespace: 'ns', reason: 'OOMKilled', severity: 'critical' }],
        healthyPods: [],
        nodeStatus: 'warning',
        eventsSummary: []
      }
    });

    await analysisNode(state);

    const userMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(userMessage).toContain('Node status: warning');
  });

  it('should not include node status in prompt when healthy', async () => {
    await analysisNode(stateWithIssue);

    const userMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(userMessage).not.toContain('Node status:');
  });

  it('SYSTEM_PROMPT should include confidence signal tags', () => {
    expect(SYSTEM_PROMPT).toContain('[direct evidence]');
    expect(SYSTEM_PROMPT).toContain('[inferred]');
    expect(SYSTEM_PROMPT).toContain('[speculative');
  });

  it('SYSTEM_PROMPT should instruct to cross-reference resources for OOMKilled', () => {
    expect(SYSTEM_PROMPT).toContain('OOMKilled');
    expect(SYSTEM_PROMPT).toContain('get_workload_spec');
    expect(SYSTEM_PROMPT).toContain('get_pod_metrics');
  });

  it('should include namespace constraints in the prompt when present', async () => {
    const state = makeState({
      triageResult: {
        issues: [{ podName: 'pod-1', namespace: 'ns', reason: 'Pending', severity: 'warning' }],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      },
      namespaceConstraints: {
        resourceQuotas: [{ name: 'compute-quota', hard: { 'requests.cpu': '4' }, used: { 'requests.cpu': '3.9' } }],
        limitRanges: []
      }
    });

    await analysisNode(state);

    const userMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(userMessage).toContain('Namespace Constraints');
    expect(userMessage).toContain('compute-quota');
  });

  it('should include stage 1 evidence summary in the stage 2 agent message', async () => {
    mockModelInvoke.mockResolvedValue({ content: 'Confirmed: OOMKilled by memory limit' });

    await analysisNode(stateWithIssue);

    const agentMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(agentMessage).toContain('Evidence Summary (Stage 1)');
    expect(agentMessage).toContain('Confirmed: OOMKilled by memory limit');
  });

  it('should include dependency hints in the prompt when present', async () => {
    const state = makeState({
      triageResult: {
        issues: [{ podName: 'gw-abc', namespace: 'ns', reason: 'CrashLoopBackOff', severity: 'critical' }],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      },
      dependencyHints: [{ workload: 'Deployment/gateway', hint: 'Service/rabbitmq has 0 ready endpoints' }]
    });

    await analysisNode(state);

    const userMessage = mockAgentInvoke.mock.calls[0]![0].messages[0].content;
    expect(userMessage).toContain('Dependency Hints');
    expect(userMessage).toContain('rabbitmq');
  });
});
