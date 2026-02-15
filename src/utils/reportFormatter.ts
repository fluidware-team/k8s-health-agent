import type { DiagnosticIssue, DiagnosticReport, HealthyResource } from '../types/report';
import { IssueSeverity } from '../types/report';

function formatIssue(issue: DiagnosticIssue): string {
  const lines: string[] = [];

  lines.push(`### ${issue.title}`);
  lines.push('');
  lines.push(`**Resource:** ${issue.resource.kind}/${issue.resource.name}`);
  if (issue.resource.namespace) {
    lines.push(`**Namespace:** ${issue.resource.namespace}`);
  }
  if (issue.affectedPods && issue.affectedPods.length > 0) {
    lines.push(`**Affected pods:** ${issue.affectedPods.join(', ')}`);
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

  // Render issue sections grouped by severity
  const severitySections: { severity: IssueSeverity; title: string }[] = [
    { severity: IssueSeverity.CRITICAL, title: 'Critical Issues' },
    { severity: IssueSeverity.WARNING, title: 'Warnings' },
    { severity: IssueSeverity.INFO, title: 'Info' }
  ];

  for (const { severity, title } of severitySections) {
    const issues = report.issues.filter(i => i.severity === severity);
    if (issues.length > 0) {
      lines.push('', `## ${title}`, '');
      issues.forEach(issue => {
        lines.push(formatIssue(issue), '');
      });
    }
  }

  // LLM Analysis
  if (report.llmAnalysis) {
    lines.push('');
    lines.push('## Analysis & Proposed Solutions');
    lines.push('');
    lines.push(report.llmAnalysis);
  }

  // Healthy Resources
  if (report.healthyResources.length > 0) {
    lines.push('');
    lines.push(formatHealthyResources(report.healthyResources));
  }

  return lines.join('\n');
}
