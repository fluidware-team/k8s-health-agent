import * as k8s from '@kubernetes/client-node';
import { getLogger } from '@fluidware-it/saddlebag';

const kc = new k8s.KubeConfig();
try {
  kc.loadFromDefault();
  getLogger().info(`K8s context loaded: ${kc.getCurrentContext()}`);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  getLogger().error(`Failed to load Kubernetes configuration: ${message}`);
  throw new Error(`Kubernetes configuration error: ${message}`);
}

export const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
export const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
export const k8sBatchApi = kc.makeApiClient(k8s.BatchV1Api);

// Metrics API client
export const k8sMetricsClient = new k8s.Metrics(kc);
