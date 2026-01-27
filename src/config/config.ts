export interface AppConfig {
  defaultModel: string;
  defaultNamespace: string;
  checkpointDir: string;
  logLevel: string;
}

export function getConfig(): AppConfig {
  return {
    defaultModel: process.env.K8S_AGENT_MODEL || 'openai/gpt-4o-mini',
    defaultNamespace: process.env.K8S_AGENT_NAMESPACE || 'default',
    checkpointDir: process.env.K8S_AGENT_CHECKPOINT_DIR || getDefaultCheckpointDir(),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

function getDefaultCheckpointDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return `${homeDir}/.k8s-health-agent/checkpoints`;
}

export function getEnvVar(name: string, defaultValue?: string): string | undefined {
  return process.env[name] || defaultValue;
}

export function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}
