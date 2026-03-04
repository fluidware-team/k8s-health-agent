# k8s-health-agent

A CLI tool that diagnoses the health of a Kubernetes namespace using a multi-phase AI agent pipeline.

It triages pods, nodes, and events; deep-dives into failing workloads (logs, metrics, resource specs); runs a LangGraph ReAct agent to correlate findings; and produces a structured markdown report with root-cause hypotheses and remediation steps.

Each run is saved as a JSON snapshot in `~/.k8s-health-agent/` for future trend analysis.

## How it works

1. **Triage** — fetches pods, nodes, events, ResourceQuota/LimitRange, and service endpoints
2. **Deep dive** — investigates each critical/warning workload: logs, metrics, container spec
3. **Analysis** — a ReAct agent (Anthropic Claude or Ollama) cross-references findings, correlates timestamps, infers upstream/downstream dependencies
4. **Report** — prints a markdown report grouped by workload with severity, affected pods, suggested `kubectl` commands, and LLM analysis

## Requirements

- Node.js >= 22.14
- A valid kubeconfig (`~/.kube/config` or `KUBECONFIG` env var) pointing at your cluster
- An Anthropic API key **or** a local Ollama instance

## Setup

```bash
npm ci
```

Create a `.env` file in the project root:

**.env**

```
# Use Anthropic Claude (default)
ANTHROPIC_API_KEY=sk-ant-...

# Or use a local Ollama model instead
# OLLAMA_MODEL=llama3.2
```

## Usage

```bash
# Development (ts-node)
npm run start:dev <namespace>

# Production (compiled)
npm run build
npm start <namespace>
```

**Examples**

```bash
npm run start:dev default          # diagnose the "default" namespace
npm run start:dev production       # diagnose the "production" namespace
```

The report is printed to stdout. Log output goes to stderr (structured JSON via pino).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Anthropic API key. Required unless using Ollama. |
| `OLLAMA_MODEL` | — | Ollama model name (e.g. `llama3.2`). When set, Ollama is used instead of Anthropic. |
| `ANALYSIS_MAX_ITERATIONS` | `3` | Max tool-call rounds for the ReAct agent. Set to `0` to skip the agent and use a single LLM call. |

## Development

```bash
npm test          # run all tests (vitest)
npm run test:watch  # watch mode
npm run lint      # ESLint
npm run lint:fix  # ESLint with auto-fix
npm run build     # compile TypeScript
```
