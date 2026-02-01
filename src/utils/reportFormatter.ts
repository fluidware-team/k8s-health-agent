import { IssueSeverity, DiagnosticIssue, DiagnosticReport, HealthyResource } from '../types/report';

// Re-export types for convenience
export { IssueSeverity } from '../types/report';
export type { DiagnosticIssue, DiagnosticReport, HealthyResource } from '../types/report';

function formatIssue(issue: DiagnosticIssue): string {
  const lines: string[] = [];

  lines.push(`### ${issue.title}`);
  lines.push('');
  lines.push(`**Resource:** ${issue.resource.kind}/${issue.resource.name}`);
  if (issue.resource.namespace) {
    lines.push(`**Namespace:** ${issue.resource.namespace}`);
  }
  lines.push('');
  lines.push(issue.description);

  if (issue.suggestedCommands && issue.suggestedCommands.length > 0) {
    lines.push('');
    lines.push('### Suggested Commands');
    lines.push('```bash');
    issue.suggestedCommands.forEach(cmd => {
      lines.push(cmd);
    });
    lines.push('```');
  }

  if (issue.nextSteps && issue.nextSteps.length > 0) {
    lines.push('');
    lines.push('### Next Steps');
    issue.nextSteps.forEach(step => {
      lines.push(`- ${step}`);
    });
  }

  return lines.join('\n');
}

function formatHealthyResources(resources: HealthyResource[]): string {
  if (resources.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Healthy Resources');
  lines.push('');
  lines.push('| Kind | Name | Status |');
  lines.push('|------|------|--------|');
  resources.forEach(r => {
    lines.push(`| ${r.kind} | ${r.name} | ${r.status} |`);
  });

  return lines.join('\n');
}

export function formatReport(report: DiagnosticReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Diagnostic Report: ${report.namespace}`);
  lines.push('');
  lines.push(`**Generated:** ${report.timestamp}`);
  lines.push('');
  lines.push(`**Summary:** ${report.summary}`);
  lines.push('');
  lines.push('---');

  // Group issues by severity
  const criticalIssues = report.issues.filter(i => i.severity === IssueSeverity.CRITICAL);
  const warningIssues = report.issues.filter(i => i.severity === IssueSeverity.WARNING);
  const infoIssues = report.issues.filter(i => i.severity === IssueSeverity.INFO);

  // Critical Issues
  if (criticalIssues.length > 0) {
    lines.push('');
    lines.push('## Critical Issues');
    lines.push('');
    criticalIssues.forEach(issue => {
      lines.push(formatIssue(issue));
      lines.push('');
    });
  }

  // Warnings
  if (warningIssues.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    warningIssues.forEach(issue => {
      lines.push(formatIssue(issue));
      lines.push('');
    });
  }

  // Info
  if (infoIssues.length > 0) {
    lines.push('');
    lines.push('## Info');
    lines.push('');
    infoIssues.forEach(issue => {
      lines.push(formatIssue(issue));
      lines.push('');
    });
  }

  // Healthy Resources
  if (report.healthyResources.length > 0) {
    lines.push('');
    lines.push(formatHealthyResources(report.healthyResources));
  }

  return lines.join('\n');
}
