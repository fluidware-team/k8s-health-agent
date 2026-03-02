// Regex to detect a stack frame line (Node.js, Java, Python styles)
const STACK_FRAME_RE = /^\s+(at |File "|in <)/;

// Regex to detect an ISO-like timestamp at the start of a line
const TIMESTAMP_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/;

// Keywords that indicate an error-level log line
const ERROR_KEYWORDS = /\b(ERROR|FATAL|Exception|Error:)/;

const MAX_STACK_TOP_FRAMES = 3;
const MIN_STACK_FRAMES_TO_TRIM = MAX_STACK_TOP_FRAMES + 2; // need at least 5 to be worth trimming

/**
 * Collapse consecutive identical lines into a single line with a repeat count.
 * "foo\nfoo\nfoo" → "foo [repeated 3x]"
 */
export function deduplicateLines(lines: string[]): string[] {
  if (lines.length === 0) return [];

  const result: string[] = [];
  let current = lines[0]!;
  let count = 1;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === current) {
      count++;
    } else {
      result.push(count > 1 ? `${current} [repeated ${count}x]` : current);
      current = lines[i]!;
      count = 1;
    }
  }
  result.push(count > 1 ? `${current} [repeated ${count}x]` : current);

  return result;
}

/**
 * Find the timestamp of the first error-level line.
 * Returns an ISO timestamp string, or null if none found.
 */
export function extractFirstErrorTimestamp(lines: string[]): string | null {
  for (const line of lines) {
    if (ERROR_KEYWORDS.test(line)) {
      const match = TIMESTAMP_RE.exec(line);
      if (match) return match[1]!;
    }
  }
  return null;
}

/**
 * Trim long stack traces to top 3 frames + "... N frames trimmed" + bottom 1 frame.
 * Leaves short traces (≤ MIN_STACK_FRAMES_TO_TRIM) and non-stack logs unchanged.
 */
export function trimStackTrace(lines: string[]): string[] {
  // Find the first run of stack frame lines
  const startIdx = lines.findIndex(l => STACK_FRAME_RE.test(l));
  if (startIdx === -1) return lines;

  let endIdx = startIdx;
  while (endIdx + 1 < lines.length && STACK_FRAME_RE.test(lines[endIdx + 1]!)) {
    endIdx++;
  }

  const frameCount = endIdx - startIdx + 1;
  if (frameCount < MIN_STACK_FRAMES_TO_TRIM) return lines;

  const trimmed = frameCount - MAX_STACK_TOP_FRAMES - 1;
  const topFrames = lines.slice(startIdx, startIdx + MAX_STACK_TOP_FRAMES);
  const bottomFrame = lines[endIdx]!;

  return [
    ...lines.slice(0, startIdx),
    ...topFrames,
    `    ... ${trimmed} frames trimmed`,
    bottomFrame,
    ...lines.slice(endIdx + 1)
  ];
}

/**
 * Pre-process raw pod log text before passing to the LLM:
 * 1. Deduplicate repeated lines
 * 2. Trim long stack traces
 * 3. Prepend a <!-- first-error: <ts> --> comment when a timestamp is found
 */
export function preprocessLogs(raw: string): string {
  if (!raw) return '';

  const lines = raw.split('\n');

  // Extract first-error timestamp before dedup (timestamps may be on repeated lines)
  const firstErrorTs = extractFirstErrorTimestamp(lines);

  const deduped = deduplicateLines(lines);
  const trimmed = trimStackTrace(deduped);

  const processed = trimmed.join('\n');
  return firstErrorTs ? `<!-- first-error: ${firstErrorTs} -->\n${processed}` : processed;
}
