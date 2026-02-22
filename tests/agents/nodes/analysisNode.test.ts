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

import { analysisNode } from '../../../src/agents/nodes/analysisNode';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { DiagnosticStateType } from '../../../src/agents/state';

function makeState(overrides: Partial<DiagnosticStateType> = {}): DiagnosticStateType {
  return {
    namespace: 'default',
    messages: [],
    triageResult: null,
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
    // Default: mock agent returns a final analysis message
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

  it('should use createReactAgent by default and return analysis', async () => {
    const result = await analysisNode(stateWithIssue);

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
    mockModelInvoke.mockResolvedValue({ content: 'Fallback analysis' });

    const result = await analysisNode(stateWithIssue);

    expect(createReactAgent).not.toHaveBeenCalled();
    expect(mockModelInvoke).toHaveBeenCalledOnce();
    expect(result.llmAnalysis).toBe('Fallback analysis');
  });

  it('should return empty analysis when the agent fails', async () => {
    mockAgentInvoke.mockRejectedValue(new Error('API error'));

    const result = await analysisNode(stateWithIssue);

    expect(result.llmAnalysis).toBe('');
  });
});
