import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a mock KubeConfig class
class MockKubeConfig {
  private contexts = [
    { name: 'dev-cluster' },
    { name: 'staging-cluster' },
    { name: 'prod-cluster' },
  ];
  private currentContext = 'dev-cluster';

  loadFromDefault = vi.fn();
  getContexts = vi.fn().mockReturnValue(this.contexts);
  getCurrentContext = vi.fn().mockReturnValue(this.currentContext);
  setCurrentContext = vi.fn((ctx: string) => {
    this.currentContext = ctx;
    this.getCurrentContext.mockReturnValue(ctx);
  });
  makeApiClient = vi.fn().mockReturnValue({});
}

// Create a mock Metrics class (must be a proper class/constructor, not arrow function)
class MockMetrics {
  constructor(_kc: unknown) {
    // Mock constructor accepts KubeConfig
  }
}

// Mock the kubernetes client module
vi.mock('@kubernetes/client-node', () => ({
  KubeConfig: MockKubeConfig,
  CoreV1Api: vi.fn(),
  AppsV1Api: vi.fn(),
  Metrics: MockMetrics,
}));

// Reset module state before each test
beforeEach(async () => {
  vi.resetModules();
});

describe('contextManager', () => {
  describe('listContexts', () => {
    it('should return all available contexts', async () => {
      const { listContexts } = await import('../../src/cluster/contextManager');
      const contexts = listContexts();

      expect(contexts).toHaveLength(3);
      expect(contexts).toContain('dev-cluster');
      expect(contexts).toContain('staging-cluster');
      expect(contexts).toContain('prod-cluster');
    });
  });

  describe('getCurrentContext', () => {
    it('should return the current context name', async () => {
      const { getCurrentContext } = await import('../../src/cluster/contextManager');
      const current = getCurrentContext();
      expect(current).toBe('dev-cluster');
    });
  });

  describe('switchContext', () => {
    it('should throw error for invalid context', async () => {
      const { switchContext } = await import('../../src/cluster/contextManager');
      expect(() => switchContext('non-existent-cluster')).toThrow();
    });

    it('should switch to a valid context', async () => {
      const { switchContext, getCurrentContext } = await import('../../src/cluster/contextManager');
      switchContext('staging-cluster');
      // After switching, the context should be updated
      expect(getCurrentContext()).toBe('staging-cluster');
    });
  });

  describe('ContextManager class', () => {
    it('should create an instance with default context', async () => {
      const { ContextManager } = await import('../../src/cluster/contextManager');
      const manager = new ContextManager();
      expect(manager.getCurrentContextName()).toBe('dev-cluster');
    });

    it('should create an instance with specific context', async () => {
      const { ContextManager } = await import('../../src/cluster/contextManager');
      const manager = new ContextManager('staging-cluster');
      expect(manager.getCurrentContextName()).toBe('staging-cluster');
    });

    it('should provide K8s API clients', async () => {
      const { ContextManager } = await import('../../src/cluster/contextManager');
      const manager = new ContextManager();
      expect(manager.getCoreApi()).toBeDefined();
      expect(manager.getAppsApi()).toBeDefined();
      expect(manager.getMetricsClient()).toBeDefined();
    });

    it('should throw for invalid context', async () => {
      const { ContextManager } = await import('../../src/cluster/contextManager');
      expect(() => new ContextManager('invalid-context')).toThrow();
    });
  });

  describe('getContextNames', () => {
    it('should return an array of context names', async () => {
      const { getContextNames } = await import('../../src/cluster/contextManager');
      const names = getContextNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names).toContain('dev-cluster');
    });
  });
});
