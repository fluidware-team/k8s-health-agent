import { describe, it, expect } from 'vitest';
import { buildDiagnosticReport, groupIssuesByWorkload, type SummaryInput } from '../../../src/agents/nodes/summaryNode';
import { IssueSeverity } from '../../../src/types/report';

describe('summaryNode', () => {
  describe('buildDiagnosticReport', () => {
    it('should build a report with critical issues', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [
            {
              podName: 'crash-pod',
              namespace: 'default',
              containerName: 'main',
              reason: 'CrashLoopBackOff',
              severity: 'critical',
              restarts: 10,
              message: 'Back-off 5m0s restarting failed container'
            }
          ],
          healthyPods: ['healthy-pod-1', 'healthy-pod-2'],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: ['## Investigation: crash-pod\nError: Connection refused'],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      expect(report.namespace).toBe('default');
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0]!.severity).toBe(IssueSeverity.CRITICAL);
      expect(report.issues[0]!.title).toContain('CrashLoopBackOff');
      expect(report.issues[0]!.suggestedCommands).toBeDefined();
      expect(report.healthyResources).toHaveLength(2);
    });

    it('should build a report for a healthy cluster', () => {
      const input: SummaryInput = {
        namespace: 'production',
        triageResult: {
          issues: [],
          healthyPods: ['api-server', 'web-frontend', 'worker'],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: [],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      expect(report.summary).toContain('healthy');
      expect(report.issues).toHaveLength(0);
      expect(report.healthyResources).toHaveLength(3);
    });

    it('should include suggested kubectl commands for issues', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [
            {
              podName: 'oom-pod',
              namespace: 'default',
              reason: 'OOMKilled',
              severity: 'critical',
              message: 'Container killed due to OOM'
            }
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: [],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      const issue = report.issues[0]!;
      expect(issue.suggestedCommands).toContain('kubectl describe pod oom-pod -n default');
      expect(issue.suggestedCommands?.some(cmd => cmd.includes('logs'))).toBe(true);
    });

    it('should set appropriate severity for warning issues', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [
            {
              podName: 'restarting-pod',
              namespace: 'default',
              reason: 'HighRestartCount',
              severity: 'warning',
              restarts: 5
            }
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: [],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      expect(report.issues[0]!.severity).toBe(IssueSeverity.WARNING);
    });

    it('should include node status in summary when unhealthy', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [],
          healthyPods: [],
          nodeStatus: 'critical',
          eventsSummary: []
        },
        deepDiveFindings: [],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      expect(report.summary.toLowerCase()).toContain('node');
    });

    it('should include LLM analysis in the report when provided', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [
            {
              podName: 'crash-pod',
              namespace: 'default',
              reason: 'CrashLoopBackOff',
              severity: 'critical'
            }
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: [],
        llmAnalysis: '**Root cause:** Database connection refused\n**Remediation:** Check DB service'
      };

      const report = buildDiagnosticReport(input);

      expect(report.llmAnalysis).toContain('Root cause');
      expect(report.llmAnalysis).toContain('Database connection refused');
    });

    it('should not include LLM analysis when empty', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [],
          healthyPods: ['pod-1'],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: [],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      expect(report.llmAnalysis).toBeUndefined();
    });

    it('should include deep dive findings in issue description', () => {
      const input: SummaryInput = {
        namespace: 'default',
        triageResult: {
          issues: [
            {
              podName: 'error-pod',
              namespace: 'default',
              reason: 'CrashLoopBackOff',
              severity: 'critical'
            }
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: []
        },
        deepDiveFindings: ['## Investigation: error-pod\nFatal error: Database connection failed at startup'],
        llmAnalysis: ''
      };

      const report = buildDiagnosticReport(input);

      expect(report.issues[0]!.description).toContain('Database connection failed');
    });
  });

  describe('groupIssuesByWorkload', () => {
    it('should group pods with the same owner and reason into one issue', () => {
      const issues = [
        {
          podName: 'gw-aaa',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        },
        {
          podName: 'gw-bbb',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        },
        {
          podName: 'gw-ccc',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        }
      ];

      const result = groupIssuesByWorkload(issues, []);

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toContain('gateway');
      expect(result[0]!.title).toContain('3 pods');
      expect(result[0]!.resource.kind).toBe('Deployment');
      expect(result[0]!.resource.name).toBe('gateway');
      expect(result[0]!.affectedPods).toEqual(['gw-aaa', 'gw-bbb', 'gw-ccc']);
    });

    it('should keep different owners as separate groups', () => {
      const issues = [
        {
          podName: 'gw-aaa',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        },
        {
          podName: 'api-xxx',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'api'
        }
      ];

      const result = groupIssuesByWorkload(issues, []);

      expect(result).toHaveLength(2);
      expect(result[0]!.resource.name).toBe('gateway');
      expect(result[1]!.resource.name).toBe('api');
    });

    it('should keep pods without an owner as individual entries', () => {
      const issues = [
        { podName: 'standalone-1', namespace: 'ns', reason: 'Failed', severity: 'critical' as const },
        { podName: 'standalone-2', namespace: 'ns', reason: 'Failed', severity: 'critical' as const }
      ];

      const result = groupIssuesByWorkload(issues, []);

      expect(result).toHaveLength(2);
      expect(result[0]!.resource.kind).toBe('Pod');
      expect(result[0]!.resource.name).toBe('standalone-1');
      expect(result[0]!.affectedPods).toBeUndefined();
      expect(result[1]!.resource.name).toBe('standalone-2');
    });

    it('should aggregate deep-dive findings across grouped pods', () => {
      const issues = [
        {
          podName: 'gw-aaa',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        },
        {
          podName: 'gw-bbb',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        }
      ];
      const findings = [
        '## Investigation: gw-aaa\nLogs:\nConnection refused',
        '## Investigation: gw-bbb\nLogs:\nTimeout waiting for DB'
      ];

      const result = groupIssuesByWorkload(issues, findings);

      expect(result).toHaveLength(1);
      expect(result[0]!.description).toContain('Connection refused');
      expect(result[0]!.description).toContain('Timeout waiting for DB');
    });

    it('should separate same-owner issues with different reasons', () => {
      const issues = [
        {
          podName: 'gw-aaa',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        },
        {
          podName: 'gw-bbb',
          namespace: 'ns',
          reason: 'OOMKilled',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        }
      ];

      const result = groupIssuesByWorkload(issues, []);

      expect(result).toHaveLength(2);
      expect(result[0]!.title).toContain('CrashLoopBackOff');
      expect(result[1]!.title).toContain('OOMKilled');
    });

    it('should use owner in title for single-pod groups with owner info', () => {
      const issues = [
        {
          podName: 'gw-aaa',
          namespace: 'ns',
          reason: 'CrashLoopBackOff',
          severity: 'critical' as const,
          ownerKind: 'Deployment',
          ownerName: 'gateway'
        }
      ];

      const result = groupIssuesByWorkload(issues, []);

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('CrashLoopBackOff: Deployment/gateway');
      expect(result[0]!.resource.kind).toBe('Deployment');
      expect(result[0]!.affectedPods).toBeUndefined();
    });
  });
});
