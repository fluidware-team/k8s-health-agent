import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { FileCheckpointer, type CheckpointData } from '../../src/persistence/fileCheckpointer';

describe('FileCheckpointer', () => {
  const testDir = join(process.cwd(), '.test-checkpoints');
  let checkpointer: FileCheckpointer;

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    checkpointer = new FileCheckpointer(testDir);
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('save and load', () => {
    it('should save and load checkpoint data', async () => {
      const threadId = 'test-thread-1';
      const data: CheckpointData = {
        namespace: 'default',
        timestamp: '2024-01-01T00:00:00Z',
        triageResult: {
          issues: [{ podName: 'test-pod', reason: 'CrashLoopBackOff', severity: 'critical', namespace: 'default' }],
          healthyPods: ['healthy-pod'],
          nodeStatus: 'healthy',
          eventsSummary: [],
        },
        deepDiveFindings: ['Investigation result'],
      };

      await checkpointer.save(threadId, data);
      const loaded = await checkpointer.load(threadId);

      expect(loaded).toEqual(data);
    });

    it('should return null for non-existent checkpoint', async () => {
      const loaded = await checkpointer.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('should create checkpoint directory if it does not exist', async () => {
      const nestedDir = join(testDir, 'nested', 'dir');
      const nestedCheckpointer = new FileCheckpointer(nestedDir);

      await nestedCheckpointer.save('test', { namespace: 'default', timestamp: new Date().toISOString() });

      expect(existsSync(nestedDir)).toBe(true);
    });

    it('should overwrite existing checkpoint', async () => {
      const threadId = 'overwrite-test';
      const data1: CheckpointData = { namespace: 'ns1', timestamp: '2024-01-01T00:00:00Z' };
      const data2: CheckpointData = { namespace: 'ns2', timestamp: '2024-01-02T00:00:00Z' };

      await checkpointer.save(threadId, data1);
      await checkpointer.save(threadId, data2);

      const loaded = await checkpointer.load(threadId);
      expect(loaded?.namespace).toBe('ns2');
    });
  });

  describe('list', () => {
    it('should list all checkpoint thread IDs', async () => {
      await checkpointer.save('thread-1', { namespace: 'ns1', timestamp: new Date().toISOString() });
      await checkpointer.save('thread-2', { namespace: 'ns2', timestamp: new Date().toISOString() });
      await checkpointer.save('thread-3', { namespace: 'ns3', timestamp: new Date().toISOString() });

      const threads = await checkpointer.list();

      expect(threads).toHaveLength(3);
      expect(threads).toContain('thread-1');
      expect(threads).toContain('thread-2');
      expect(threads).toContain('thread-3');
    });

    it('should return empty array when no checkpoints exist', async () => {
      const threads = await checkpointer.list();
      expect(threads).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete a checkpoint', async () => {
      const threadId = 'delete-test';
      await checkpointer.save(threadId, { namespace: 'default', timestamp: new Date().toISOString() });

      await checkpointer.delete(threadId);

      const loaded = await checkpointer.load(threadId);
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent checkpoint', async () => {
      await expect(checkpointer.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getLatest', () => {
    it('should get the most recently saved checkpoint', async () => {
      await checkpointer.save('thread-old', { namespace: 'old', timestamp: '2024-01-01T00:00:00Z' });
      // Small delay to ensure different modification times
      await new Promise(r => setTimeout(r, 10));
      await checkpointer.save('thread-new', { namespace: 'new', timestamp: '2024-01-02T00:00:00Z' });

      const latest = await checkpointer.getLatest();

      expect(latest?.data.namespace).toBe('new');
    });

    it('should return null when no checkpoints exist', async () => {
      const latest = await checkpointer.getLatest();
      expect(latest).toBeNull();
    });
  });
});
