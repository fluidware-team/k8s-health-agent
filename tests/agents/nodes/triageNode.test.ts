import { describe, it, expect } from 'vitest';
import { analyzeTriageData, extractTriageIssues } from '../../../src/agents/nodes/triageNode';
import type { TriageData } from '../../../src/types';
import type { OwnerMap } from '../../../src/utils/ownerResolver';

describe('triageNode', () => {
  describe('extractTriageIssues', () => {
    it('should identify CrashLoopBackOff pods as critical', () => {
      const pods = [
        {
          name: 'healthy-pod',
          namespace: 'default',
          status: 'Running',
          restarts: 0,
          containers: [{ name: 'main', image: 'nginx', ready: true, state: 'Running' }]
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
              stateMessage: 'Back-off 5m0s restarting failed container'
            }
          ]
        }
      ];

      const issues = extractTriageIssues(pods, []);

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
          containers: [{ name: 'main', image: 'app', ready: true, state: 'Running' }]
        }
      ];

      const issues = extractTriageIssues(pods, []);

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
              message: 'Insufficient cpu'
            }
          ]
        }
      ];

      const issues = extractTriageIssues(pods, []);

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
          involvedObject: { kind: 'Pod', name: 'oom-pod', namespace: 'default' }
        }
      ];

      const issues = extractTriageIssues([], events);

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
          involvedObject: { kind: 'Pod', name: 'mount-fail-pod', namespace: 'default' }
        }
      ];

      const issues = extractTriageIssues([], events);

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
          containers: [{ name: 'main', image: 'app', state: 'CrashLoopBackOff' }]
        }
      ];

      const events = [
        {
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          type: 'Warning',
          involvedObject: { kind: 'Pod', name: 'problem-pod', namespace: 'default' }
        }
      ];

      const issues = extractTriageIssues(pods, events);

      // Should only have one issue for the pod (CrashLoopBackOff takes precedence)
      const podIssues = issues.filter(i => i.podName === 'problem-pod');
      expect(podIssues).toHaveLength(1);
      expect(podIssues[0]!.reason).toBe('CrashLoopBackOff');
    });

    it('should return empty issues when no pods or events', () => {
      const issues = extractTriageIssues([], []);
      expect(issues).toHaveLength(0);
    });
  });

  describe('owner enrichment via analyzeTriageData', () => {
    it('should enrich issues with resolved owner from ownerMap', () => {
      const data: TriageData = {
        pods: [
          {
            name: 'web-deploy-abc123-xyz',
            namespace: 'default',
            status: 'Running',
            restarts: 10,
            containers: [{ name: 'main', image: 'app', state: 'CrashLoopBackOff' }],
            ownerReferences: [{ kind: 'ReplicaSet', name: 'web-deploy-abc123' }]
          }
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: []
      };

      const ownerMap: OwnerMap = new Map();
      ownerMap.set('ReplicaSet/web-deploy-abc123', { kind: 'Deployment', name: 'web-deploy' });

      const result = analyzeTriageData(data, ownerMap);
      const issue = result.triageResult.issues[0]!;

      expect(issue.ownerKind).toBe('Deployment');
      expect(issue.ownerName).toBe('web-deploy');
    });

    it('should use direct owner when no parent mapping exists', () => {
      const data: TriageData = {
        pods: [
          {
            name: 'sts-pod-0',
            namespace: 'default',
            status: 'Failed',
            restarts: 0,
            containers: [{ name: 'main', image: 'app' }],
            ownerReferences: [{ kind: 'StatefulSet', name: 'my-sts' }]
          }
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: []
      };

      const result = analyzeTriageData(data);
      const issue = result.triageResult.issues[0]!;

      expect(issue.ownerKind).toBe('StatefulSet');
      expect(issue.ownerName).toBe('my-sts');
    });

    it('should leave owner fields undefined for pods without ownerReferences', () => {
      const data: TriageData = {
        pods: [
          {
            name: 'standalone-pod',
            namespace: 'default',
            status: 'Failed',
            restarts: 0,
            containers: [{ name: 'main', image: 'app' }]
          }
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: []
      };

      const result = analyzeTriageData(data);
      const issue = result.triageResult.issues[0]!;

      expect(issue.ownerKind).toBeUndefined();
      expect(issue.ownerName).toBeUndefined();
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
            containers: [{ name: 'main', image: 'app', state: 'CrashLoopBackOff' }]
          }
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: []
      };

      const result = analyzeTriageData(data);

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
            containers: [{ name: 'main', image: 'nginx', ready: true, state: 'Running' }]
          }
        ],
        nodes: [{ name: 'node-1', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: []
      };

      const result = analyzeTriageData(data);

      expect(result.needsDeepDive).toBe(false);
      expect(result.triageResult.issues).toHaveLength(0);
      expect(result.triageResult.healthyPods).toContain('healthy-pod');
    });

    it('should set nodeStatus based on node conditions', () => {
      const unhealthyData: TriageData = {
        pods: [],
        nodes: [{ name: 'bad-node', conditions: [{ type: 'Ready', status: 'False' }] }],
        events: []
      };

      const unhealthyResult = analyzeTriageData(unhealthyData);
      expect(unhealthyResult.triageResult.nodeStatus).toBe('critical');

      const healthyData: TriageData = {
        pods: [],
        nodes: [{ name: 'good-node', conditions: [{ type: 'Ready', status: 'True' }] }],
        events: []
      };

      const healthyResult = analyzeTriageData(healthyData);
      expect(healthyResult.triageResult.nodeStatus).toBe('healthy');
    });
  });
});
