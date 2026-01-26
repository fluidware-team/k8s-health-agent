import * as k8s from '@kubernetes/client-node';
import { getLogger } from '@fluidware-it/saddlebag';

const kc = new k8s.KubeConfig();
kc.loadFromDefault(); // Loads the current context from your terminal
getLogger().info(`K8s context loaded: ${kc.getCurrentContext()}`);

export const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
export const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);

// Metrics API client
export const k8sMetricsClient = new k8s.Metrics(kc);

// Export kc for use in custom API calls
export { kc };
