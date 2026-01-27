import * as k8s from '@kubernetes/client-node';
import { getLogger } from '@fluidware-it/saddlebag';

const logger = getLogger();

// Singleton KubeConfig for context management
let _kubeConfig: k8s.KubeConfig | null = null;

function getKubeConfig(): k8s.KubeConfig {
  if (!_kubeConfig) {
    _kubeConfig = new k8s.KubeConfig();
    _kubeConfig.loadFromDefault();
  }
  return _kubeConfig;
}

export function listContexts(): string[] {
  const kc = getKubeConfig();
  return kc.getContexts().map(ctx => ctx.name);
}

export function getCurrentContext(): string {
  const kc = getKubeConfig();
  return kc.getCurrentContext();
}

export function getContextNames(): string[] {
  return listContexts();
}

export function switchContext(contextName: string): void {
  const kc = getKubeConfig();
  const contexts = listContexts();

  if (!contexts.includes(contextName)) {
    throw new Error(`Context "${contextName}" not found. Available contexts: ${contexts.join(', ')}`);
  }

  kc.setCurrentContext(contextName);
  logger.info(`Switched to context: ${contextName}`);
}

export class ContextManager {
  private readonly kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private metricsClient: k8s.Metrics;
  private currentContextName: string;

  constructor(contextName?: string) {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();

    if (contextName) {
      const contexts = this.kc.getContexts().map(c => c.name);
      if (!contexts.includes(contextName)) {
        throw new Error(`Context "${contextName}" not found. Available: ${contexts.join(', ')}`);
      }
      this.kc.setCurrentContext(contextName);
    }

    this.currentContextName = this.kc.getCurrentContext();
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.metricsClient = new k8s.Metrics(this.kc);

    logger.info(`ContextManager initialized with context: ${this.currentContextName}`);
  }

  getCurrentContextName(): string {
    return this.currentContextName;
  }

  getCoreApi(): k8s.CoreV1Api {
    return this.coreApi;
  }

  getAppsApi(): k8s.AppsV1Api {
    return this.appsApi;
  }

  getMetricsClient(): k8s.Metrics {
    return this.metricsClient;
  }

  getKubeConfig(): k8s.KubeConfig {
    return this.kc;
  }

  switchContext(contextName: string): void {
    const contexts = this.kc.getContexts().map(c => c.name);
    if (!contexts.includes(contextName)) {
      throw new Error(`Context "${contextName}" not found. Available: ${contexts.join(', ')}`);
    }

    this.kc.setCurrentContext(contextName);
    this.currentContextName = contextName;

    // Recreate API clients for new context
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.metricsClient = new k8s.Metrics(this.kc);

    logger.info(`Switched to context: ${contextName}`);
  }

  static listAvailableContexts(): string[] {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    return kc.getContexts().map(c => c.name);
  }
}

// Default context manager instance
let _defaultManager: ContextManager | null = null;

export function getContextManager(contextName?: string): ContextManager {
  if (!_defaultManager || (contextName && _defaultManager.getCurrentContextName() !== contextName)) {
    _defaultManager = new ContextManager(contextName);
  }
  return _defaultManager;
}

export function resetContextManager(): void {
  _defaultManager = null;
}
