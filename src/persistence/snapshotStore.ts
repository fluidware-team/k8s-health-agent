import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getLogger } from '@fluidware-it/saddlebag';
import type { DiagnosticReport } from '../types/report';

const APP_DIR_NAME = '.k8s-health-agent';
const DEFAULT_CONTEXT = 'default';
const SNAPSHOT_EXT = '.json';

const BASE_DIR = path.join(os.homedir(), APP_DIR_NAME);

// Format an ISO timestamp for use as a filename: replace colons with dashes, strip milliseconds.
// e.g. "2026-03-04T14:32:00.000Z" → "2026-03-04T14-32-00"
function formatTimestampForFilename(iso: string): string {
  return iso.replace(/:|\.\d{3}Z$/g, m => (m[0] === ':' ? '-' : ''));
}

function snapshotDir(namespace: string, context: string): string {
  return path.join(BASE_DIR, context, namespace);
}

/**
 * Save a completed diagnostic report as a JSON snapshot.
 * Returns the saved file path, or null on failure (silent — never crashes a run).
 */
export async function saveSnapshot(report: DiagnosticReport, context = DEFAULT_CONTEXT): Promise<string | null> {
  const dir = snapshotDir(report.namespace, context);
  const filename = `${formatTimestampForFilename(report.timestamp)}${SNAPSHOT_EXT}`;
  const filePath = path.join(dir, filename);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(report), 'utf-8');
    getLogger().info(`Snapshot saved: ${filePath}`);
    return filePath;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    getLogger().warn(`Failed to save snapshot: ${message}`);
    return null;
  }
}

/**
 * List all snapshot file paths for a namespace, sorted chronologically.
 * Returns an empty array if the directory doesn't exist yet.
 */
export async function listSnapshots(namespace: string, context = DEFAULT_CONTEXT): Promise<string[]> {
  const dir = snapshotDir(namespace, context);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter(f => f.endsWith(SNAPSHOT_EXT))
      .sort()
      .map(f => path.join(dir, f));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    getLogger().warn(`Failed to list snapshots: ${message}`);
    return [];
  }
}

/**
 * Load and parse a snapshot from the given file path.
 */
export async function loadSnapshot(filePath: string): Promise<DiagnosticReport> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as DiagnosticReport;
}
