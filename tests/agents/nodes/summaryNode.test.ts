import { describe, it, expect } from 'vitest';
import { buildDiagnosticReport, type SummaryInput } from '../../../src/agents/nodes/summaryNode';
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
              message: 'Back-off 5m0s restarting failed container',
            },
          ],
          healthyPods: ['healthy-pod-1', 'healthy-pod-2'],
          nodeStatus: 'healthy',
          eventsSummary: [],
        },
        deepDiveFindings: ['## Investigation: crash-pod\nError: Connection refused'],
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
          eventsSummary: [],
        },
        deepDiveFindings: [],
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
              message: 'Container killed due to OOM',
            },
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: [],
        },
        deepDiveFindings: [],
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
              restarts: 5,
            },
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: [],
        },
        deepDiveFindings: [],
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
          eventsSummary: [],
        },
        deepDiveFindings: [],
      };

      const report = buildDiagnosticReport(input);

      expect(report.summary.toLowerCase()).toContain('node');
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
              severity: 'critical',
            },
          ],
          healthyPods: [],
          nodeStatus: 'healthy',
          eventsSummary: [],
        },
        deepDiveFindings: [
          '## Investigation: error-pod\nFatal error: Database connection failed at startup',
        ],
      };

      const report = buildDiagnosticReport(input);

      expect(report.issues[0]!.description).toContain('Database connection failed');
    });
  });
});
