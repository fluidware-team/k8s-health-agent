import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DiagnosticReport } from '../../src/types/report';
import { IssueSeverity } from '../../src/types/report';

// We mock fs/promises to avoid touching the real filesystem
vi.mock('fs/promises');

const mockMkdir = vi.mocked(fs.mkdir);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockReadFile = vi.mocked(fs.readFile);
const mockReaddir = vi.mocked(fs.readdir);

const SAMPLE_REPORT: DiagnosticReport = {
  namespace: 'production',
  timestamp: '2026-03-04T14:32:00.000Z',
  summary: 'Found 1 critical issue(s) and 0 warning(s) in namespace "production".',
  issues: [
    {
      severity: IssueSeverity.CRITICAL,
      title: 'CrashLoopBackOff: Deployment/gateway',
      description: 'Pod gateway-abc is crashing.',
      resource: { kind: 'Deployment', name: 'gateway', namespace: 'production' }
    }
  ],
  llmAnalysis: 'Root cause: misconfigured env var.'
};

describe('snapshotStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('saveSnapshot', () => {
    it('should create the snapshot directory and write the file', async () => {
      const { saveSnapshot } = await import('../../src/persistence/snapshotStore');

      await saveSnapshot(SAMPLE_REPORT);

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('production'), { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        JSON.stringify(SAMPLE_REPORT),
        'utf-8'
      );
    });

    it('should return the file path where the snapshot was saved', async () => {
      const { saveSnapshot } = await import('../../src/persistence/snapshotStore');

      const savedPath = await saveSnapshot(SAMPLE_REPORT);

      expect(savedPath).toMatch(/\.json$/);
      expect(savedPath).toContain('production');
    });

    it('should include a sanitized timestamp in the filename', async () => {
      const { saveSnapshot } = await import('../../src/persistence/snapshotStore');

      const savedPath = await saveSnapshot(SAMPLE_REPORT);

      // ISO colons replaced with dashes: 2026-03-04T14-32-00
      expect(savedPath).toContain('2026-03-04T14-32-00');
    });

    it('should use "default" as context when not provided', async () => {
      const { saveSnapshot } = await import('../../src/persistence/snapshotStore');

      const savedPath = await saveSnapshot(SAMPLE_REPORT);

      expect(savedPath).toContain(`${path.sep}default${path.sep}`);
    });

    it('should use the provided context in the path', async () => {
      const { saveSnapshot } = await import('../../src/persistence/snapshotStore');

      const savedPath = await saveSnapshot(SAMPLE_REPORT, 'my-cluster');

      expect(savedPath).toContain(`${path.sep}my-cluster${path.sep}`);
    });

    it('should not throw when mkdir or writeFile fails (silent fallback)', async () => {
      mockMkdir.mockRejectedValue(new Error('permission denied'));
      const { saveSnapshot } = await import('../../src/persistence/snapshotStore');

      await expect(saveSnapshot(SAMPLE_REPORT)).resolves.toBeNull();
    });
  });

  describe('listSnapshots', () => {
    it('should return sorted snapshot file paths for a namespace', async () => {
      mockReaddir.mockResolvedValue([
        '2026-03-04T10-00-00.json',
        '2026-03-04T14-32-00.json',
        '2026-03-03T08-00-00.json'
      ] as any);
      const { listSnapshots } = await import('../../src/persistence/snapshotStore');

      const results = await listSnapshots('production');

      expect(results).toHaveLength(3);
      // Sorted alphabetically = chronologically for ISO-based names
      expect(results[0]).toContain('2026-03-03T08-00-00');
      expect(results[2]).toContain('2026-03-04T14-32-00');
    });

    it('should return empty array when directory does not exist', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const { listSnapshots } = await import('../../src/persistence/snapshotStore');

      const results = await listSnapshots('production');

      expect(results).toEqual([]);
    });

    it('should return empty array on any other I/O error', async () => {
      mockReaddir.mockRejectedValue(new Error('permission denied'));
      const { listSnapshots } = await import('../../src/persistence/snapshotStore');

      const results = await listSnapshots('production');

      expect(results).toEqual([]);
    });
  });

  describe('loadSnapshot', () => {
    it('should parse and return a DiagnosticReport from a file', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(SAMPLE_REPORT) as any);
      const { loadSnapshot } = await import('../../src/persistence/snapshotStore');

      const report = await loadSnapshot('/some/path/2026-03-04T14-32-00.json');

      expect(report.namespace).toBe('production');
      expect(report.issues).toHaveLength(1);
      expect(report.timestamp).toBe('2026-03-04T14:32:00.000Z');
    });
  });
});
