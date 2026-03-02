# k8s-health-agent — Remaining Work

Phases 1–3, all PLAN-cleanup.md steps (1–12) are done.
See PLAN-status.md for details. This file tracks what is still missing.

---

## Phase 4: Investigation Depth & Intelligence

**Branch:** `feature/04-intelligence`

### 4.0 Prompt-level quick wins (no new tools)

**4.0a Node status in analysis prompt** [partial — trivial fix]
`buildAnalysisPrompt()` destructs `triageResult` but never uses `nodeStatus`.
Add it to the prompt preamble: "Node status: warning (MemoryPressure)".
**File:** `src/agents/nodes/analysisNode.ts`

**4.0b Confidence signals**
Add to system prompt: tag each hypothesis with `[direct evidence]`, `[inferred]`, or `[speculative — no logs]`.
**File:** `src/agents/nodes/analysisNode.ts`

**4.0c Guide agent to cross-reference resources vs usage** [partial — tool exists, agent uninstructed]
`get_workload_spec` (limits) and `get_pod_metrics` (actual usage) exist but the agent isn't told to call both.
Add explicit instruction: "For OOMKilled or HighRestartCount, call `get_workload_spec` and `get_pod_metrics` and compare."
**File:** `src/agents/nodes/analysisNode.ts`

### 4.1 Log pre-processing

Pre-process raw logs before passing to LLM:
- deduplicate repeated lines (show `repeated N times`)
- extract first-error timestamp
- trim stack traces to top + bottom frame

**Tests:** `tests/utils/logPreprocessor.test.ts`
**Files:**
- `src/utils/logPreprocessor.ts` — new
- `src/agents/nodes/deepDiveNode.ts` — apply before appending to findings

### 4.2 ResourceQuota / LimitRange awareness

Fetch `ResourceQuota` and `LimitRange` objects once per run during triage.
Inject as "Namespace constraints" into the analysis prompt.
Explains Pending pods (quota exhausted) and OOMKilled (LimitRange default silently overriding spec).

**Tests:** `tests/tools/namespaceConstraintsTool.test.ts`
**Files:**
- `src/tools/triageTools.ts` — add `listNamespaceConstraintsTool`
- `src/agents/nodes/triageNode.ts` — fetch in parallel with pods/nodes/events
- `src/agents/state.ts` — add `namespaceConstraints` field
- `src/agents/nodes/analysisNode.ts` — include in prompt

### 4.3 Cross-pod timestamp correlation

For issues grouped under the same owner workload, extract first-error timestamps from
events and correlate them across pods. If they coincide, note it in the prompt:
"All 5 gateway pods started failing at ~14:32 UTC, 2 min after rabbitmq restarted."

**Tests:** `tests/utils/timestampCorrelator.test.ts`
**Files:**
- `src/utils/timestampCorrelator.ts` — new
- `src/agents/nodes/analysisNode.ts` — call before building prompt

### 4.4 Chain-of-thought two-stage analysis

Split the single LLM call into two sequential steps:
1. Per-issue evidence summary: "What does the data say?" (structured, concise)
2. Cross-issue reasoning: "Which are root causes vs downstream victims? Priority?"

Cap stage 1 with structured output to keep token usage bounded.

**File:** `src/agents/nodes/analysisNode.ts`

### 4.5 Root cause vs downstream victim inference

Detect cascading failures without a service mesh:
- fetch Services + their Endpoints (which have 0 ready endpoints?)
- cross-reference failing workload labels against Service selectors
- check env var names for references to broken service names
- inject dependency hints into prompt: "gateway-aqc may be downstream of rabbitmq (0/1 ready endpoints)"

**Tests:** `tests/utils/dependencyInferrer.test.ts`
**Files:**
- `src/utils/dependencyInferrer.ts` — new
- `src/agents/nodes/triageNode.ts` — run in parallel, store in state
- `src/agents/nodes/analysisNode.ts` — include hints in prompt

---

## Phase 5: Multi-Context + Snapshot Persistence

**Branch:** `feature/05-multicontext-snapshots`

### 5.1 Multi-Context Support

Switch between kubectl contexts via CLI flag.

**Tests:** `tests/cluster/contextManager.test.ts`
**Files:**
- `src/cluster/contextManager.ts` — list and switch contexts
- `src/cluster/k8sClient.ts` — accept context param
- `src/index.ts` — add `--context <name>` flag

### 5.2 Run Snapshots

Persist each completed run as a JSON snapshot (`~/.k8s-health-agent/<context>/<namespace>/<timestamp>.json`).
Foundation for trend analysis in Phase 6. No UI yet — just save/load.

**Tests:** `tests/persistence/snapshotStore.test.ts`
**Files:**
- `src/persistence/snapshotStore.ts` — save, list, load snapshots
- `src/agents/diagnosticGraph.ts` — save snapshot after summary node

---

## Phase 6: Trend Analysis + Watch Mode

**Branch:** `feature/06-trends-watch`

### 6.1 Trend Analysis

Load previous snapshot and compute a diff:
- new issues (appeared since last run)
- resolved issues (gone since last run)
- worsened issues (restart count grew, severity escalated)
- health score per namespace (0–100, severity-weighted)

Inject diff into LLM analysis prompt. Render "Changes since last run" section in report.

**Tests:** `tests/analysis/trendAnalyzer.test.ts`
**Files:**
- `src/analysis/trendAnalyzer.ts` — `diffSnapshots()`, `computeHealthScore()`
- `src/agents/nodes/analysisNode.ts` — include diff in prompt when available
- `src/utils/reportFormatter.ts` — render trend section + health score header

### 6.2 Watch Mode

`--watch <interval>` re-runs diagnosis on a fixed interval.
After the first full report, subsequent runs print only the diff.
Ctrl-C exits cleanly.

**Tests:** `tests/cli/watchMode.test.ts`
**Files:**
- `src/cli/watchMode.ts` — interval loop, diff-only output after first run
- `src/index.ts` — add `--watch <interval>` flag

---

## Phase 7: Interactive Report Viewer + Fix Script

**Branch:** `feature/07-interactive-viewer`

### 7.1 Interactive Report Viewer

Post-run interactive pager. Keyboard nav:
- `↑`/`↓` — move between issues
- `Enter`/`Space` — expand/collapse issue details
- `f` — filter to critical only
- `q` — quit

Executive summary table always visible; detail blocks collapsed by default.
Lightweight: readline-based, no heavy TUI framework.
Skipped when stdout is not a TTY (pipe-friendly).

**Tests:** `tests/cli/reportViewer.test.ts`
**Files:**
- `src/cli/reportViewer.ts` — collapse/expand state machine
- `src/index.ts` — enter viewer after report unless `--no-interactive`

### 7.2 Actionable Fix Script

Write `fix-<namespace>.sh` alongside the report with kubectl commands from LLM proposals,
ordered by priority, commented. User reviews and runs it directly.

**Tests:** `tests/utils/fixScriptGenerator.test.ts`
**Files:**
- `src/utils/fixScriptGenerator.ts` — extract commands from issues, write shell script
- `src/agents/nodes/summaryNode.ts` — trigger script generation

---

## Verification (each phase)

```bash
npm test          # all tests pass
npm run build     # tsc clean
npm start -- <ns> # smoke-test existing flow
```
