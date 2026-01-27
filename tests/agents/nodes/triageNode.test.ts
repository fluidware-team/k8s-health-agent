import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeTriageData, extractTriageIssues, type TriageData } from '../../../src/agents/nodes/triageNode';

describe('triageNode', () => {
  describe('extractTriageIssues', () => {
    it('should identify CrashLoopBackOff pods as critical', () => {
      const pods = [
        {
          name: 'healthy-pod',
          namespace: 'default',
          status: 'Running',
          restarts: 0,
          containers: [{ name: 'main', image: 'nginx', ready: true, state: 'Running' }],
        },
        {
          name: 'crashing-pod',
          namespace: 'default',
          status: 'Running',
          restarts: 10,
          containers: [
            {
              name: 'main',
              image: 'broken',
              ready: false,
              state: 'CrashLoopBackOff',
              stateMessage: 'Back-off 5m0s restarting failed container',
            },
          ],
        },
      ];

      const issues = extractTriageIssues(pods, [], []);

      expect(issues).toHaveLength(1);
      expect(issues[0]!.podName).toBe('crashing-pod');
      expect(issues[0]!.severity).toBe('critical');
      expect(issues[0]!.reason).toBe('CrashLoopBackOff');
    });

    it('should identify pods with high restarts as warnings', () => {
      const pods = [
        {
          name: 'restarting-pod',
          namespace: 'default',
          status: 'Running',
          restarts: 5,
          containers: [{ name: 'main', image: 'app', ready: true, state: 'Running' }],
        },
      ];

      const issues = extractTriageIssues(pods, [], []);

      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe('warning');
      expect(issues[0]!.reason).toBe('HighRestartCount');
      expect(issues[0]!.restarts).toBe(5);
    });

    it('should identify Pending pods as issues', () => {
      const pods = [
        {
          name: 'pending-pod',
          namespace: 'default',
          status: 'Pending',
          restarts: 0,
          containers: [{ name: 'main', image: 'nginx' }],
          conditions: [
            {
              type: 'PodScheduled',
              status: 'False',
              reason: 'Unschedulable',
              message: 'Insufficient cpu',
            },
          ],
        },
      ];

      const issues = extractTriageIssues(pods, [], []);

      expect(issues).toHaveLength(1);
      expect(issues[0]!.reason).toBe('Pending');
      expect(issues[0]!.message).toContain('Insufficient cpu');
    });

    it('should identify OOMKilled events', () => {
      const events = [
        {
          reason: 'OOMKilled',
          message: 'Container killed due to OOM',
          type: 'Warning',
          count: 3,
          involvedObject: { kind: 'Pod', name: 'oom-pod', namespace: 'default' },
        },
      ];

      const issues = extractTriageIssues([], [], events);

      expect(issues).toHaveLength(1);
      expect(issues[0]!.podName).toBe('oom-pod');
      expect(issues[0]!.severity).toBe('critical');
      expect(issues[0]!.reason).toBe('OOMKilled');
    });

    it('should identify FailedMount events', () => {
      const events = [
        {
          reason: 'FailedMount',
          message: 'MountVolume.SetUp failed for volume "secret-vol"',
          type: 'Warning',
          involvedObject: { kind: 'Pod', name: 'mount-fail-pod', namespace: 'default' },
        },
      ];

      const issues = extractTriageIssues([], [], events);

      expect(issues).toHaveLength(1);
      expect(issues[0]!.reason).toBe('FailedMount');
      expect(issues[0]!.severity).toBe('critical');
    });

    it('should not duplicate issues found in both pods and events', () => {
      const pods = [
        {
          name: 'problem-pod',
          namespace: 'default',
          status: 'Running',
          restarts: 10,
          containers: [{ name: 'main', image: 'app', state: 'CrashLoopBackOff' }],
        },
      ];

      const events = [
        {
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          type: 'Warning',
          involvedObject: { kind: 'Pod', name: 'problem-pod', namespace: 'default' },
        },
      ];

      const issues = extractTriageIssues(pods, [], events);

      // Should only have one issue for the pod (CrashLoopBackOff takes precedence)
      const podIssues = issues.filter(i => i.podName === 'problem-pod');
      expect(podIssues).toHaveLength(1);
      expect(podIssues[0]!.reason).toBe('CrashLoopBackOff');
    });

    it('should identify unhealthy nodes', () => {
      const nodes = [
        {
          name: 'unhealthy-node',
          conditions: [
            { type: 'Ready', status: 'False', reason: 'KubeletNotReady' },
            { type: 'MemoryPressure', status: 'True', message: 'High memory usage' },
          ],
        },
      ];

      const issues = extractTriageIssues([], nodes, []);

      // Node issues don't create pod issues, but we track them
      expect(issues.length).toBe(0);
    });
  });

  describe('analyzeTriageData', () => {
    it('should return needsDeepDive=true when critical issues found', () => {
      const data: TriageData = {
        pods: [
          {
            name: 'crash-pod',
            namespace: 'default',
            status: 'Running',
            restarts: 10,
            containers: [{ name: 'main', image: 'app', state: 'CrashLoopBackOff' }],
          },
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: [],
      };

      const result = analyzeTriageData(data, 'default');

      expect(result.needsDeepDive).toBe(true);
      expect(result.triageResult.issues.length).toBeGreaterThan(0);
    });

    it('should return needsDeepDive=false when cluster is healthy', () => {
      const data: TriageData = {
        pods: [
          {
            name: 'healthy-pod',
            namespace: 'default',
            status: 'Running',
            restarts: 0,
            containers: [{ name: 'main', image: 'nginx', ready: true, state: 'Running' }],
          },
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: [],
      };

      const result = analyzeTriageData(data, 'default');

      expect(result.needsDeepDive).toBe(false);
      expect(result.triageResult.issues).toHaveLength(0);
      expect(result.triageResult.healthyPods).toContain('healthy-pod');
    });

    it('should set nodeStatus based on node conditions', () => {
      const unhealthyData: TriageData = {
        pods: [],
        nodes: [{ name: 'bad-node', conditions: [{ type: 'Ready', status: 'False' }] }],
        events: [],
      };

      const unhealthyResult = analyzeTriageData(unhealthyData, 'default');
      expect(unhealthyResult.triageResult.nodeStatus).toBe('critical');

      const healthyData: TriageData = {
        pods: [],
        nodes: [{ name: 'good-node', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: [],
      };

      const healthyResult = analyzeTriageData(healthyData, 'default');
      expect(healthyResult.triageResult.nodeStatus).toBe('healthy');
    });
  });
});
