import { describe, it, expect } from 'vitest';
import { formatReport, DiagnosticReport, IssueSeverity } from '../../src/utils/reportFormatter';

describe('reportFormatter', () => {
  describe('formatReport', () => {
    it('should format a report with critical issues', () => {
      const report: DiagnosticReport = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
        summary: 'Found 2 critical issues',
        issues: [
          {
            severity: IssueSeverity.CRITICAL,
            title: 'Pod CrashLoopBackOff',
            description: 'Pod my-app-123 is in CrashLoopBackOff with 10 restarts',
            resource: { kind: 'Pod', name: 'my-app-123', namespace: 'default' },
            suggestedCommands: ['kubectl logs my-app-123 -n default --previous']
          },
          {
            severity: IssueSeverity.CRITICAL,
            title: 'OOMKilled Event',
            description: 'Container was killed due to out of memory',
            resource: { kind: 'Pod', name: 'my-app-123', namespace: 'default' },
            suggestedCommands: ['kubectl describe pod my-app-123 -n default', 'kubectl top pod my-app-123 -n default']
          }
        ],
        healthyResources: []
      };

      const formatted = formatReport(report);

      expect(formatted).toContain('# Diagnostic Report: default');
      expect(formatted).toContain('## Critical Issues');
      expect(formatted).toContain('Pod CrashLoopBackOff');
      expect(formatted).toContain('OOMKilled Event');
      expect(formatted).toContain('kubectl logs my-app-123 -n default --previous');
    });

    it('should format a report with warning issues', () => {
      const report: DiagnosticReport = {
        namespace: 'production',
        timestamp: '2024-01-01T00:00:00Z',
        summary: 'Found 1 warning',
        issues: [
          {
            severity: IssueSeverity.WARNING,
            title: 'High Restart Count',
            description: 'Pod api-server has 5 restarts in the last hour',
            resource: { kind: 'Pod', name: 'api-server', namespace: 'production' }
          }
        ],
        healthyResources: []
      };

      const formatted = formatReport(report);

      expect(formatted).toContain('## Warnings');
      expect(formatted).toContain('High Restart Count');
      expect(formatted).not.toContain('## Critical Issues');
    });

    it('should format a healthy cluster report', () => {
      const report: DiagnosticReport = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
        summary: 'Cluster is healthy',
        issues: [],
        healthyResources: [
          { kind: 'Pod', name: 'web-app', status: 'Running' },
          { kind: 'Pod', name: 'api-server', status: 'Running' },
          { kind: 'Node', name: 'node-1', status: 'Ready' }
        ]
      };

      const formatted = formatReport(report);

      expect(formatted).toContain('## Healthy Resources');
      expect(formatted).toContain('web-app');
      expect(formatted).toContain('api-server');
      expect(formatted).toContain('node-1');
      expect(formatted).not.toContain('## Critical Issues');
      expect(formatted).not.toContain('## Warnings');
    });

    it('should include suggested commands section', () => {
      const report: DiagnosticReport = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
        summary: 'Found issues',
        issues: [
          {
            severity: IssueSeverity.CRITICAL,
            title: 'Failed Mount',
            description: 'Secret volume could not be mounted',
            resource: { kind: 'Pod', name: 'app-123' },
            suggestedCommands: [
              'kubectl get secret db-credentials -n default',
              'kubectl describe pod app-123 -n default'
            ]
          }
        ],
        healthyResources: []
      };

      const formatted = formatReport(report);

      expect(formatted).toContain('### Suggested Commands');
      expect(formatted).toContain('```bash');
      expect(formatted).toContain('kubectl get secret db-credentials -n default');
    });

    it('should separate issues by severity', () => {
      const report: DiagnosticReport = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
        summary: 'Mixed issues found',
        issues: [
          {
            severity: IssueSeverity.WARNING,
            title: 'Warning Issue',
            description: 'A warning',
            resource: { kind: 'Pod', name: 'pod-1' }
          },
          {
            severity: IssueSeverity.CRITICAL,
            title: 'Critical Issue',
            description: 'A critical issue',
            resource: { kind: 'Pod', name: 'pod-2' }
          },
          {
            severity: IssueSeverity.INFO,
            title: 'Info Message',
            description: 'Just informational',
            resource: { kind: 'Pod', name: 'pod-3' }
          }
        ],
        healthyResources: []
      };

      const formatted = formatReport(report);

      // Critical should appear before Warning
      const criticalIndex = formatted.indexOf('## Critical Issues');
      const warningIndex = formatted.indexOf('## Warnings');
      const infoIndex = formatted.indexOf('## Info');

      expect(criticalIndex).toBeLessThan(warningIndex);
      expect(warningIndex).toBeLessThan(infoIndex);
    });

    it('should include next steps section for issues', () => {
      const report: DiagnosticReport = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
        summary: 'Issues found',
        issues: [
          {
            severity: IssueSeverity.CRITICAL,
            title: 'Pod Crash',
            description: 'Pod crashed',
            resource: { kind: 'Pod', name: 'app' },
            nextSteps: ['Check application logs', 'Review resource limits', 'Check for OOM events']
          }
        ],
        healthyResources: []
      };

      const formatted = formatReport(report);

      expect(formatted).toContain('### Next Steps');
      expect(formatted).toContain('Check application logs');
      expect(formatted).toContain('Review resource limits');
    });
  });

  describe('DiagnosticIssue', () => {
    it('should support all severity levels', () => {
      expect(IssueSeverity.CRITICAL).toBe('critical');
      expect(IssueSeverity.WARNING).toBe('warning');
      expect(IssueSeverity.INFO).toBe('info');
    });
  });
});
