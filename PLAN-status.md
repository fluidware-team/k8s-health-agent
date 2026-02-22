# Plan Status: Cleaner Diagnostic Report

## Step 1: Add LLM analysis node [DONE]

**Branch:** `feature/05-llm-analysis` (from `main`)

### What was done

- Extracted `ChatAnthropic` / `ChatOllama` model selection from the dead
  `k8sAgent.ts` into a shared `src/agents/modelProvider.ts`
- Deleted `src/agents/k8sAgent.ts` (dead code since Phase 2)
- Created `src/agents/nodes/analysisNode.ts` — calls the LLM with a structured
  prompt containing triage results and deep-dive findings, asks for root-cause
  hypotheses, remediation steps, and priority per issue
- Wired the new node into the LangGraph graph:
  `triage → deep-dive → analysis → summary → END`
- Added `llmAnalysis` field to `DiagnosticState` and `DiagnosticReport`
- Added `proposedSolution` field to `DiagnosticIssue` (for future per-issue use)
- Updated `summaryNode` to pass LLM analysis into the report
- Updated `reportFormatter` to render an "Analysis & Proposed Solutions" section
- Graceful fallback: if the LLM call fails, the report still works without it
- Fixed false "healthy" report when cluster is unreachable — `triageNode` now
  tracks API parse failures and returns a `ClusterUnreachable` critical issue
  when all three K8s API calls fail (`needsDeepDive: false`, skips deep-dive)
- Added `ClusterUnreachable` handling in `summaryNode` (`getSuggestedCommands`,
  `getNextSteps`) — suggests `kubectl cluster-info` instead of nonsensical pod commands
- Removed unused `_nodes` param from `extractTriageIssues()`
- Removed unused `_namespace` param from `analyzeTriageData()`
- Deleted dead code: `src/prompts/systemPrompt.ts` (entire file, 5 unused exports),
  `allTools` export from `src/tools/k8sTools.ts`

### Commits

- `4b3d778` feat: add LLM analysis node with Anthropic/Ollama fallback
- `a7a61cf` fix: report ClusterUnreachable when all K8s API calls fail

### Files changed

| File | Action |
|------|--------|
| `src/agents/modelProvider.ts` | Created |
| `src/agents/k8sAgent.ts` | Deleted |
| `src/agents/nodes/analysisNode.ts` | Created |
| `src/agents/diagnosticGraph.ts` | Modified — added analysis node + edge |
| `src/agents/state.ts` | Modified — added `llmAnalysis` |
| `src/types/report.ts` | Modified — added `proposedSolution`, `llmAnalysis` |
| `src/types/summary.ts` | Modified — added `llmAnalysis` to `SummaryInput` |
| `src/agents/nodes/summaryNode.ts` | Modified — LLM analysis, `ClusterUnreachable` handling |
| `src/agents/nodes/triageNode.ts` | Modified — cluster-unreachable detection, removed unused params |
| `src/utils/reportFormatter.ts` | Modified — renders LLM analysis section |
| `src/tools/k8sTools.ts` | Modified — removed unused `allTools` export |
| `src/prompts/systemPrompt.ts` | Deleted |
| `tests/agents/modelProvider.test.ts` | Created — 2 tests |
| `tests/agents/nodes/analysisNode.test.ts` | Created — 5 tests |
| `tests/agents/diagnosticGraph.test.ts` | Modified — mock, state field, cluster-unreachable test |
| `tests/agents/nodes/summaryNode.test.ts` | Modified — `llmAnalysis` fixtures, 2 new tests |
| `tests/agents/nodes/triageNode.test.ts` | Modified — updated call signatures |
| `tests/utils/reportFormatter.test.ts` | Modified — 2 new tests for LLM section |

### Test results

- 66 tests passing (was 60)
- Lint clean

---

## Step 2: Clean up error messages and dead code [DONE]

### What was done

- Added `extractK8sErrorMessage()` helper to `deepDiveTools.ts` — parses K8s API
  error objects (tries `e.body` JSON `.message`, `e.response.body.message`,
  `e.message`) instead of dumping raw JSON into the report
- Changed error return from `Error while reading pod ... logs: ${JSON.stringify(e)}`
  to `Logs unavailable for <pod>: <human-readable message>`
- Refactored `deepDiveNode.ts`: extracted `formatMetricsSection()` to reduce
  cyclomatic complexity, added named constants (`MAX_ISSUES_TO_INVESTIGATE`,
  `DEEP_DIVE_TAIL_LINES`, `PREVIOUS_LOG_REASONS`, `METRICS_REASONS`),
  destructured state, removed redundant typeof check
- DRY'd `reportFormatter.ts`: replaced 3 copy-pasted severity section blocks
  with a single data-driven loop
- Added try-catch around `kc.loadFromDefault()` in `k8sClient.ts` with clear
  error message on config failure
- Fixed `extractK8sErrorMessage` fall-through: JSON body with no `.message`
  field now continues to other strategies instead of returning silently

#### Dead code removed

| Removed | Reason |
|---------|--------|
| `src/analysis/resourceAnalyzer.ts` | Entire module (3 exports) never imported |
| `tests/analysis/resourceAnalyzer.test.ts` | Tests for dead module |
| `src/tools/k8sTools.ts` | Re-export convenience file, no src/ consumer |
| `getNodeMetricsTool` + `deepDiveTools` array | Never invoked by any node |
| `k8sAppsApi` export from `k8sClient.ts` | Never imported |
| `kc` export from `k8sClient.ts` | Never imported outside the file |
| Type re-exports from `reportFormatter.ts` | Unused convenience re-exports |

### Commits

- `55440f4` refactor: clean up error messages and remove dead code

### Files changed

| File | Action |
|------|--------|
| `src/tools/deepDiveTools.ts` | Modified — `extractK8sErrorMessage`, removed `getNodeMetricsTool` |
| `src/agents/nodes/deepDiveNode.ts` | Modified — refactored, named constants, clean errors |
| `src/cluster/k8sClient.ts` | Modified — try-catch, removed `k8sAppsApi` and `kc` exports |
| `src/utils/reportFormatter.ts` | Modified — DRY severity sections, removed type re-exports |
| `src/tools/k8sTools.ts` | Deleted |
| `src/analysis/resourceAnalyzer.ts` | Deleted |
| `tests/analysis/resourceAnalyzer.test.ts` | Deleted |
| `tests/tools/readPodLogsTool.test.ts` | Created — 6 tests |
| `tests/agents/nodes/deepDiveNode.test.ts` | Created — 4 tests |
| `tests/tools/metricsTool.test.ts` | Modified — removed `getNodeMetricsTool` tests |
| `tests/tools/eventsTool.test.ts` | Modified — import from `triageTools` directly |
| `tests/utils/reportFormatter.test.ts` | Modified — import types from `types/report` |

### Test results

- 65 tests passing (was 66 — removed 11 dead tests, added 10 new ones)
- Lint clean

## Step 3: Add owner-reference resolution [DONE]

**Branch:** `feature/06-owner-reference-resolution` (from `main`)

### What was done

- Added `OwnerReference` interface to `src/types/k8s.ts` and `ownerReferences?`
  field to `FilteredPod`
- Updated `k8sDataFilter.ts` to extract and pass through `metadata.ownerReferences`
  from raw K8s pod objects; extracted `getPodIdentity()` to keep cyclomatic
  complexity under the lint threshold
- Added `ownerKind?` and `ownerName?` fields to `TriageIssue` in `src/types/triage.ts`
- Added `k8sAppsApi` (AppsV1Api) and `k8sBatchApi` (BatchV1Api) exports to
  `k8sClient.ts`
- Created `src/utils/ownerResolver.ts`:
  - `buildOwnerMap(namespace)` — fetches ReplicaSets and Jobs in parallel,
    builds a lookup map (`ReplicaSet/name` → parent Deployment, `Job/name` → parent CronJob)
  - `resolveOwner(podOwnerRefs, ownerMap)` — walks the chain to find the
    highest-level owner (Pod → RS → Deployment, Pod → Job → CronJob, etc.)
  - Graceful fallback: if RS/Job API calls fail, owner fields are left undefined
- Wired into `triageNode`:
  - `buildOwnerMap()` runs in parallel with existing pod/node/event fetches
  - `enrichIssuesWithOwners()` annotates each `TriageIssue` with resolved
    `ownerKind`/`ownerName` after issue extraction
  - `analyzeTriageData()` now accepts an optional `ownerMap` parameter

### Commits

- `82cb2c2` feat: add owner-reference resolution to triage

### Files changed

| File | Action |
|------|--------|
| `src/types/k8s.ts` | Modified — added `OwnerReference` interface, `ownerReferences?` to `FilteredPod` |
| `src/types/triage.ts` | Modified — added `ownerKind?`, `ownerName?` to `TriageIssue` |
| `src/utils/k8sDataFilter.ts` | Modified — extract ownerReferences, extracted `getPodIdentity()` |
| `src/utils/ownerResolver.ts` | Created — `buildOwnerMap`, `resolveOwner`, `OwnerMap` type |
| `src/cluster/k8sClient.ts` | Modified — added `k8sAppsApi`, `k8sBatchApi` exports |
| `src/agents/nodes/triageNode.ts` | Modified — owner enrichment, `buildOwnerMap` in parallel |
| `tests/utils/ownerResolver.test.ts` | Created — 8 tests |
| `tests/utils/k8sDataFilter.test.ts` | Modified — 2 new tests for ownerReferences |
| `tests/agents/nodes/triageNode.test.ts` | Modified — 3 new tests for owner enrichment |

### Test results

- 78 tests passing (was 65 — added 13 new tests)
- Lint clean

## Step 4: Classify Jobs/CronJobs separately [DONE]

**Branch:** `feature/06-owner-reference-resolution` (continued from Step 3)

### What was done

- Expanded `TriageIssue.severity` from `'critical' | 'warning'` to
  `'critical' | 'warning' | 'info'`
- Added `reclassifyBatchIssues()` in `triageNode.ts` — after owner enrichment,
  downgrades `Failed` pods owned by `Job` or `CronJob` from `critical` to `info`.
  Genuinely broken container states (CrashLoopBackOff, OOMKilled, etc.) remain
  critical even for batch workloads.
- Updated `mapSeverity()` in `summaryNode.ts` to handle the new `'info'` severity
- `deepDiveNode` already filters for `critical`/`warning` only, so info-level job
  failures are naturally skipped — freeing investigation slots for more urgent issues

### Commits

- `ede91f2` feat: classify Job/CronJob pods separately with lower severity

### Files changed

| File | Action |
|------|--------|
| `src/types/triage.ts` | Modified — added `'info'` to severity union |
| `src/agents/nodes/triageNode.ts` | Modified — `reclassifyBatchIssues()`, `BATCH_OWNER_KINDS` constant |
| `src/agents/nodes/summaryNode.ts` | Modified — `mapSeverity()` handles `'info'` |
| `tests/agents/nodes/triageNode.test.ts` | Modified — 3 new tests for batch reclassification |

### Test results

- 81 tests passing (was 78 — added 3 new tests)
- Lint clean

## Step 5: Group issues by workload [DONE]

**Branch:** `feature/07-group-by-workload` (from `main`)

### What was done

- Added `affectedPods?: string[]` field to `DiagnosticIssue` in `src/types/report.ts`
- Added `groupIssuesByWorkload()` in `summaryNode.ts` — groups `TriageIssue`s by
  `ownerKind/ownerName/reason` composite key, producing one `DiagnosticIssue` per group
  with the pod names listed in `affectedPods`
- Extracted `buildSingleIssueDescription()` and `convertGroupToIssue()` helper functions
  to keep cyclomatic complexity under the lint threshold
- Pods without owner info are kept as individual entries (backward-compatible)
- Single-pod groups with owner info show the owner in the title
  (e.g. `CrashLoopBackOff: Deployment/gateway` instead of pod name)
- Updated `buildAnalysisPrompt()` in `analysisNode.ts` to group issues by owner workload
  in the LLM prompt, giving workload-level context instead of per-pod listing
- Updated `formatIssue()` in `reportFormatter.ts` to render the `affectedPods` line
  when present

### Files changed

| File | Action |
|------|--------|
| `src/types/report.ts` | Modified — added `affectedPods?: string[]` to `DiagnosticIssue` |
| `src/agents/nodes/summaryNode.ts` | Modified — added `groupIssuesByWorkload()`, `convertGroupToIssue()`, `buildSingleIssueDescription()` |
| `src/agents/nodes/analysisNode.ts` | Modified — grouped issues by owner in `buildAnalysisPrompt()` |
| `src/utils/reportFormatter.ts` | Modified — render `affectedPods` in `formatIssue()` |
| `tests/agents/nodes/summaryNode.test.ts` | Modified — 6 new grouping tests |
| `tests/agents/nodes/analysisNode.test.ts` | Modified — 1 new owner-in-prompt test |
| `tests/utils/reportFormatter.test.ts` | Modified — 2 new affectedPods rendering tests |

### Test results

- 90 tests passing (was 81 — added 9 new tests)
- Lint clean

## Step 6: Collapse repeated issues [DONE]

**Branch:** `feature/08-collapse-repeated-issues`

### What was done

- Added `extractReason(title)` helper — parses the reason prefix from a DiagnosticIssue
  title (format `"Reason: ResourceLabel"`)
- Added `collapseIssueGroup(issues)` — merges N same-reason/same-severity issues into
  one: combined title `"Reason (N workloads affected)"`, description listing all workload
  labels, merged `affectedPods`, deduplicated `suggestedCommands` and `nextSteps`
- Added `collapseRepeatedIssues(issues)` (exported) — groups by `severity:reason` key
  and calls `collapseIssueGroup` on each group; single-issue groups pass through unchanged
- Wired `collapseRepeatedIssues` into `formatReport()` before rendering severity sections
- Created `tests/utils/collapseRepeatedIssues.test.ts` with 11 tests covering:
  distinct reasons (no collapse), same-reason collapse (2 and 3 workloads), same-reason
  different-severity (no collapse), single-issue pass-through, empty array, description
  listing, affectedPods merge, command deduplication, nextSteps deduplication, mixed scenario

### Commits

- `03fb81e` feat: collapse repeated issues in report formatter

### Files changed

| File | Action |
|------|--------|
| `src/utils/reportFormatter.ts` | Modified — added `collapseRepeatedIssues`, `collapseIssueGroup`, `extractReason`; wired into `formatReport` |
| `tests/utils/collapseRepeatedIssues.test.ts` | Created — 11 tests |

### Test results

- 101 tests passing (was 90 — added 11 new tests)
- Lint clean

## Step 7: Add executive summary table [DONE]

**Branch:** `feature/09-executive-summary-table`

### What was done

- Added `formatOverviewTable(issues)` in `reportFormatter.ts` — renders a markdown
  table with columns `Severity | Reason | Resource | Pods Affected`; uses `extractReason`
  to pull the reason prefix from each issue title; shows pod count or `-` when absent
- Wired into `formatReport()`: table is built from `collapsedIssues`, inserted after
  the `---` divider and before the detailed severity sections, followed by another `---`
- When there are no issues the table is skipped entirely (healthy cluster case)
- Added 6 new tests to `tests/utils/reportFormatter.test.ts` covering: table rendered
  when issues present, table absent when no issues, table appears before detail sections,
  pod count shown for grouped issues, dash shown when no affectedPods, all severities listed

### Commits

- `ec509b0` feat: add executive summary overview table to report

### Files changed

| File | Action |
|------|--------|
| `src/utils/reportFormatter.ts` | Modified — added `formatOverviewTable`, wired into `formatReport` |
| `tests/utils/reportFormatter.test.ts` | Modified — 6 new tests |

### Test results

- 107 tests passing (was 101 — added 6 new tests, note: step 6 branch not merged)
- Lint clean

## Step 10: Add `get_workload_spec` tool [DONE]

**Branch:** `feature/09-executive-summary-table` (continued)

### What was done

- Added `getWorkloadSpecTool` to `src/tools/investigationTools.ts`
- Accepts `kind` (deployment/statefulset/daemonset), `name`, `namespace`
- Returns: replicas, strategy, per-container spec (image, resources, env var **names only**, ports, probes), volumes with types
- Env var values are never included — only names (security boundary)
- Volume type and referenced resource name (configMap/secret/pvc) are shown
- Extracted `formatContainerList`, `formatVolumeList` to keep cyclomatic complexity under threshold

### Files changed

| File | Action |
|------|--------|
| `src/tools/investigationTools.ts` | Modified — added `getWorkloadSpecTool` and helpers |
| `tests/tools/getWorkloadSpecTool.test.ts` | Created — 8 tests (TDD) |

### Test results

- 123 tests passing (was 115 — added 8 new tests)
- Lint clean

---

## Step 9: Add `describe_resource` tool [DONE]

**Branch:** `feature/09-executive-summary-table` (continued)

### What was done

- Created `src/tools/investigationTools.ts` with `describeResourceTool`
- Accepts `kind` (pod/deployment/statefulset/daemonset), `name`, `namespace`
- Makes parallel API calls: resource fetch + namespace events
- Returns human-readable summary with: phase/replica counts, conditions, container states, recent warning events (filtered by resource name, capped at 10)
- Extracted helper functions (`formatConditions`, `formatEvents`, `formatContainerState`, `describeContainerStatuses`) to keep cyclomatic complexity under lint threshold
- Graceful error handling: K8s API errors are parsed into readable messages

### Files changed

| File | Action |
|------|--------|
| `src/tools/investigationTools.ts` | Created — `describeResourceTool` |
| `tests/tools/describeResourceTool.test.ts` | Created — 8 tests (TDD) |

### Test results

- 115 tests passing (was 107 — added 8 new tests)
- Lint clean

---

## Step 8: Compact healthy resources [DONE]

### What was done

- Removed `## Healthy Resources` table from the report entirely
- Removed `HealthyResource` interface from `src/types/report.ts`
- Removed `healthyResources` field from `DiagnosticReport` and state annotation
- Removed `formatHealthyResources()` from `reportFormatter.ts`
- Updated `summaryNode` summary line to include healthy pod count even when issues are present
  (e.g. `"Found 3 critical, 2 warnings in "vm2". 47 pods running normally."`)
- Updated tests: replaced `healthyResources` fixture fields and `toHaveLength` assertions
  with summary-line checks; rewrote the "healthy cluster" formatter test

### Files changed

| File | Action |
|------|--------|
| `src/types/report.ts` | Removed `HealthyResource` interface and `healthyResources` field |
| `src/agents/state.ts` | Removed `healthyResources` annotation and `HealthyResource` import |
| `src/agents/nodes/summaryNode.ts` | Removed healthy resources build; added healthy count to summary when issues present |
| `src/utils/reportFormatter.ts` | Removed `formatHealthyResources`, `HealthyResource` import, rendering block |
| `tests/utils/reportFormatter.test.ts` | Updated fixtures; rewrote healthy cluster test |
| `tests/agents/nodes/summaryNode.test.ts` | Replaced `healthyResources` assertions with summary checks |
| `tests/agents/nodes/deepDiveNode.test.ts` | Removed `healthyResources` from state fixture |
| `tests/agents/nodes/analysisNode.test.ts` | Removed `healthyResources` from state fixture |
| `tests/agents/diagnosticGraph.test.ts` | Removed `healthyResources` from state fixtures |

### Test results

- 107 tests passing (unchanged count — test logic updated, not added/removed)
- Lint clean
