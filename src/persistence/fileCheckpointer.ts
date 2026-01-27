import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import type { TriageResult } from '../agents/state';

export interface CheckpointData {
  namespace: string;
  timestamp: string;
  triageResult?: TriageResult;
  deepDiveFindings?: string[];
  metadata?: Record<string, unknown>;
}

export interface CheckpointWithMeta {
  threadId: string;
  data: CheckpointData;
  savedAt: Date;
}

export class FileCheckpointer {
  private readonly checkpointDir: string;

  constructor(checkpointDir: string) {
    this.checkpointDir = checkpointDir;
  }

  private ensureDir(): void {
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  private getFilePath(threadId: string): string {
    return join(this.checkpointDir, `${threadId}.json`);
  }

  async save(threadId: string, data: CheckpointData): Promise<void> {
    this.ensureDir();
    const filePath = this.getFilePath(threadId);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(threadId: string): Promise<CheckpointData | null> {
    const filePath = this.getFilePath(threadId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as CheckpointData;
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    if (!existsSync(this.checkpointDir)) {
      return [];
    }

    const files = readdirSync(this.checkpointDir);
    return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  }

  async delete(threadId: string): Promise<void> {
    const filePath = this.getFilePath(threadId);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  async getLatest(): Promise<CheckpointWithMeta | null> {
    const threads = await this.list();

    if (threads.length === 0) {
      return null;
    }

    // Find the most recently modified file
    let latest: CheckpointWithMeta | null = null;
    let latestTime = 0;

    for (const threadId of threads) {
      const filePath = this.getFilePath(threadId);
      const stat = statSync(filePath);
      const mtime = stat.mtimeMs;

      if (mtime > latestTime) {
        latestTime = mtime;
        const data = await this.load(threadId);
        if (data) {
          latest = {
            threadId,
            data,
            savedAt: stat.mtime,
          };
        }
      }
    }

    return latest;
  }
}

// Default checkpointer instance
let _defaultCheckpointer: FileCheckpointer | null = null;

export function getDefaultCheckpointer(): FileCheckpointer {
  if (!_defaultCheckpointer) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    _defaultCheckpointer = new FileCheckpointer(join(homeDir, '.k8s-health-agent', 'checkpoints'));
  }
  return _defaultCheckpointer;
}
