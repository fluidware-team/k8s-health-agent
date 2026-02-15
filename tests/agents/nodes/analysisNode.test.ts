import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the model provider
const mockInvoke = vi.fn();
vi.mock('../../../src/agents/modelProvider', () => ({
  getChatModel: () => ({ invoke: mockInvoke })
}));

import { analysisNode } from '../../../src/agents/nodes/analysisNode';
import type { DiagnosticStateType } from '../../../src/agents/state';

function makeState(overrides: Partial<DiagnosticStateType> = {}): DiagnosticStateType {
  return {
    namespace: 'default',
    messages: [],
    triageResult: null,
    deepDiveFindings: [],
    llmAnalysis: '',
    issues: [],
    healthyResources: [],
    needsDeepDive: false,
    ...overrides
  };
}

describe('analysisNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip analysis when no issues found', async () => {
    const state = makeState({
      triageResult: { issues: [], healthyPods: [], nodeStatus: 'healthy', eventsSummary: [] }
    });

    const result = await analysisNode(state);

    expect(result.llmAnalysis).toBe('');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('should skip analysis when triageResult is null', async () => {
    const state = makeState();

    const result = await analysisNode(state);

    expect(result.llmAnalysis).toBe('');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('should call the LLM and return analysis', async () => {
    mockInvoke.mockResolvedValue({ content: '**Root cause:** DB connection refused' });

    const state = makeState({
      triageResult: {
        issues: [{ podName: 'crash-pod', namespace: 'default', reason: 'CrashLoopBackOff', severity: 'critical' }],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      },
      deepDiveFindings: ['## Investigation: crash-pod\nError: Connection refused']
    });

    const result = await analysisNode(state);

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(result.llmAnalysis).toContain('Root cause');
  });

  it('should include deep-dive findings in the prompt', async () => {
    mockInvoke.mockResolvedValue({ content: 'Analysis result' });

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

    // Verify the prompt sent to the LLM contains the issue and findings
    const messages = mockInvoke.mock.calls[0]![0];
    const userMessage = messages[1].content;
    expect(userMessage).toContain('pod-1');
    expect(userMessage).toContain('OOMKilled');
    expect(userMessage).toContain('Memory usage: 512Mi');
  });

  it('should include owner workload context in the prompt', async () => {
    mockInvoke.mockResolvedValue({ content: 'Analysis result' });

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

    const messages = mockInvoke.mock.calls[0]![0];
    const userMessage = messages[1].content;
    // Both pods should be grouped under the same Deployment line
    expect(userMessage).toContain('Deployment/gateway');
    expect(userMessage).toContain('gw-aaa');
    expect(userMessage).toContain('gw-bbb');
  });

  it('should return empty analysis on LLM failure', async () => {
    mockInvoke.mockRejectedValue(new Error('API error'));

    const state = makeState({
      triageResult: {
        issues: [{ podName: 'pod-1', namespace: 'default', reason: 'CrashLoopBackOff', severity: 'critical' }],
        healthyPods: [],
        nodeStatus: 'healthy',
        eventsSummary: []
      }
    });

    const result = await analysisNode(state);

    expect(result.llmAnalysis).toBe('');
  });
});
