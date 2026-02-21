import type { DiagnosticIssue, DiagnosticReport, HealthyResource } from '../types/report';
import { IssueSeverity } from '../types/report';

// Extract the reason prefix from a DiagnosticIssue title.
// Titles follow the convention "Reason: ResourceLabel" or "Reason: ResourceLabel (N pods)".
function extractReason(title: string): string {
  const colonIndex = title.indexOf(':');
  return colonIndex !== -1 ? title.slice(0, colonIndex).trim() : title;
}

// Merge a group of same-reason/same-severity issues into a single summary issue.
function collapseIssueGroup(issues: DiagnosticIssue[]): DiagnosticIssue {
  if (issues.length === 1) return issues[0]!;

  const first = issues[0]!;
  const reason = extractReason(first.title);
  const workloadLabels = issues.map(i => `${i.resource.kind}/${i.resource.name}`);

  const title = `${reason} (${issues.length} workloads affected)`;

  // List each affected workload, then include the first issue's description as a representative example
  const description = [
    `${issues.length} workloads are affected by ${reason}:`,
    ...workloadLabels.map(l => `- **${l}**`),
    '',
    first.description
  ].join('\n');

  // Merge pod lists and deduplicate commands / next steps across all issues
  const affectedPods = issues.flatMap(i => i.affectedPods ?? []);
  const suggestedCommands = [...new Set(issues.flatMap(i => i.suggestedCommands ?? []))];
  const nextSteps = [...new Set(issues.flatMap(i => i.nextSteps ?? []))];

  return {
    severity: first.severity,
    title,
    description,
    resource: { kind: first.resource.kind, name: '(multiple)', namespace: first.resource.namespace },
    affectedPods: affectedPods.length > 0 ? affectedPods : undefined,
    suggestedCommands: suggestedCommands.length > 0 ? suggestedCommands : undefined,
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined
  };
}

// Collapse DiagnosticIssues that share the same reason and severity into a single entry.
// Issues with distinct reasons, or the same reason but different severities, are kept separate.
export function collapseRepeatedIssues(issues: DiagnosticIssue[]): DiagnosticIssue[] {
  // Group by "severity:reason" key while preserving insertion order
  const groups = new Map<string, DiagnosticIssue[]>();
  for (const issue of issues) {
    const key = `${issue.severity}:${extractReason(issue.title)}`;
    const group = groups.get(key);
    if (group) {
      group.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }

  return [...groups.values()].map(collapseIssueGroup);
}

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

  // Collapse issues that share the same reason within each severity group
  const collapsedIssues = collapseRepeatedIssues(report.issues);

  // Render issue sections grouped by severity
  const severitySections: { severity: IssueSeverity; title: string }[] = [
    { severity: IssueSeverity.CRITICAL, title: 'Critical Issues' },
    { severity: IssueSeverity.WARNING, title: 'Warnings' },
    { severity: IssueSeverity.INFO, title: 'Info' }
  ];

  for (const { severity, title } of severitySections) {
    const issues = collapsedIssues.filter(i => i.severity === severity);
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
