import type { DiagnosticIssue, DiagnosticReport } from '../types/report';
import { IssueSeverity } from '../types/report';
import type { SnapshotDiff } from '../analysis/trendAnalyzer';

// Extract the reason prefix from a DiagnosticIssue title.
// Titles follow the convention "Reason: ResourceLabel" or "Reason: ResourceLabel (N pods)".
export function extractReason(title: string): string {
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

// Render a compact overview table listing every issue with severity, reason, resource, and pod count.
// Placed near the top of the report so readers get the full picture at a glance.
function formatOverviewTable(issues: DiagnosticIssue[]): string {
  if (issues.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Overview');
  lines.push('');
  lines.push('| Severity | Reason | Resource | Pods Affected |');
  lines.push('|----------|--------|----------|---------------|');

  for (const issue of issues) {
    const severity = issue.severity.toUpperCase();
    const reason = extractReason(issue.title);
    const resource = `${issue.resource.kind}/${issue.resource.name}`;
    const pods = issue.affectedPods ? String(issue.affectedPods.length) : '-';
    lines.push(`| ${severity} | ${reason} | ${resource} | ${pods} |`);
  }

  return lines.join('\n');
}

function formatTrendSection(diff: SnapshotDiff): string {
  const lines: string[] = [];
  const scoreDelta = diff.healthScore - diff.previousHealthScore;
  const deltaStr = scoreDelta >= 0 ? `+${scoreDelta}` : `${scoreDelta}`;

  lines.push('## Changes Since Last Run');
  lines.push('');
  lines.push(`**Health score:** ${diff.healthScore}/100 (${deltaStr} vs ${diff.previousTimestamp})`);

  if (diff.newIssues.length > 0) {
    lines.push('');
    lines.push(`**New (${diff.newIssues.length}):**`);
    lines.push(...diff.newIssues.map(i => `- [${i.severity.toUpperCase()}] ${i.title}`));
  }

  if (diff.worsenedIssues.length > 0) {
    lines.push('');
    lines.push(`**Worsened (${diff.worsenedIssues.length}):**`);
    lines.push(...diff.worsenedIssues.map(i => `- [${i.severity.toUpperCase()}] ${i.title}`));
  }

  if (diff.resolvedIssues.length > 0) {
    lines.push('');
    lines.push(`**Resolved (${diff.resolvedIssues.length}):**`);
    lines.push(...diff.resolvedIssues.map(i => `- ${i.title}`));
  }

  const noChanges = diff.newIssues.length === 0 && diff.worsenedIssues.length === 0 && diff.resolvedIssues.length === 0;
  if (noChanges) {
    lines.push('');
    const message = diff.healthScore === 100 ? 'Namespace remains healthy.' : 'Same issues as last run.';
    lines.push(message);
  }

  return lines.join('\n');
}

export function formatReport(report: DiagnosticReport, trendDiff?: SnapshotDiff | null): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Diagnostic Report: ${report.namespace}`);
  lines.push('');
  lines.push(`**Generated:** ${report.timestamp}`);
  lines.push('');
  lines.push(`**Summary:** ${report.summary}`);
  lines.push('');
  lines.push('---');

  // Trend section — shown before the issue details when a previous run exists
  if (trendDiff) {
    lines.push('');
    lines.push(formatTrendSection(trendDiff));
    lines.push('');
    lines.push('---');
  }

  // Collapse issues that share the same reason within each severity group
  const collapsedIssues = collapseRepeatedIssues(report.issues);

  // Executive summary table — quick at-a-glance view before the detailed sections
  const overviewTable = formatOverviewTable(collapsedIssues);
  if (overviewTable) {
    lines.push('');
    lines.push(overviewTable);
    lines.push('');
    lines.push('---');
  }

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

  return lines.join('\n');
}
