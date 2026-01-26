# k8s-ai-agent

Agent to check the health of a Kubernetes application.

## Setup

* Install NodeJS (at least version 22.14)
* Run `npm ci`
* Create a `.env` file with a valid `ANTHROPIC_API_KEY` variable

## Usage

```bash
npm run start:dev <namespace> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--context`, `-c` | Kubernetes context to use (defaults to current context) |
| `--resume`, `-r` | Resume the most recent diagnostic session |

### Examples

```bash
# Run diagnostics on the "production" namespace using the current context
npm run start:dev production

# Run diagnostics on a specific cluster context
npm run start:dev staging --context my-cluster-context

# Resume the last diagnostic session
npm run start:dev default --resume
```

## Features

- **Multi-phase diagnostic graph** — Triage, Deep Dive, and Summary phases powered by LangGraph
- **Metrics server integration** — Resource usage analysis for pods and containers
- **Multi-context support** — Target different Kubernetes clusters via `--context`
- **Session persistence** — Diagnostic sessions are saved to `~/.k8s-health-agent/checkpoints/` and can be resumed with `--resume`
