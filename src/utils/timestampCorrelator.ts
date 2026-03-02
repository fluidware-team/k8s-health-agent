import type { TriageIssue } from '../types/triage';
import type { FilteredEvent } from '../types/k8s';

export interface CorrelationNote {
  workload: string;
  note: string;
}

// Maximum time window in milliseconds for pods to be considered "simultaneously" failing
const CORRELATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * For each owner workload with multiple failing pods, check whether their first-error
 * timestamps (from events) fall within a narrow window. If so, emit a correlation note.
 * Single-pod workloads and workloads with missing/unparseable timestamps are skipped.
 */
export function correlatePodTimestamps(issues: TriageIssue[], events: FilteredEvent[]): CorrelationNote[] {
  // Build a map from pod name → first event timestamp
  const podFirstTs = new Map<string, Date>();
  for (const event of events) {
    const podName = event.involvedObject.name;
    const tsStr = event.firstTimestamp ?? event.lastTimestamp;
    if (!tsStr) continue;
    const ts = new Date(tsStr);
    if (isNaN(ts.getTime())) continue;

    const existing = podFirstTs.get(podName);
    if (!existing || ts < existing) {
      podFirstTs.set(podName, ts);
    }
  }

  // Group issues by owner workload
  const groups = new Map<string, TriageIssue[]>();
  for (const issue of issues) {
    if (!issue.ownerKind || !issue.ownerName) continue;
    const key = `${issue.ownerKind}/${issue.ownerName}`;
    const group = groups.get(key);
    if (group) {
      group.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }

  const notes: CorrelationNote[] = [];

  for (const [workload, groupIssues] of groups) {
    // Only correlate when multiple pods are involved
    if (groupIssues.length < 2) continue;

    // Collect timestamps for pods in this group that have events
    const timestamps = groupIssues
      .map(i => podFirstTs.get(i.podName))
      .filter((ts): ts is Date => ts !== undefined);

    if (timestamps.length < 2) continue;

    const earliest = new Date(Math.min(...timestamps.map(t => t.getTime())));
    const latest = new Date(Math.max(...timestamps.map(t => t.getTime())));
    const spread = latest.getTime() - earliest.getTime();

    if (spread > CORRELATION_WINDOW_MS) continue;

    // Format the timestamp as HH:MM UTC for the note
    const timeStr = earliest.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    notes.push({
      workload,
      note: `${timestamps.length} pods started failing at ~${timeStr} (within ${Math.round(spread / 1000)}s of each other)`
    });
  }

  return notes;
}
