import { describe, it, expect } from 'vitest';
import {
  preprocessLogs,
  deduplicateLines,
  extractFirstErrorTimestamp,
  trimStackTrace
} from '../../src/utils/logPreprocessor';

describe('deduplicateLines', () => {
  it('should collapse repeated lines with a count suffix', () => {
    const input = ['line a', 'line a', 'line a', 'line b'];
    const result = deduplicateLines(input);
    expect(result).toEqual(['line a [repeated 3x]', 'line b']);
  });

  it('should leave unique lines unchanged', () => {
    const input = ['alpha', 'beta', 'gamma'];
    expect(deduplicateLines(input)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('should handle two consecutive identical lines', () => {
    const input = ['err', 'err'];
    const result = deduplicateLines(input);
    expect(result).toEqual(['err [repeated 2x]']);
  });

  it('should handle empty array', () => {
    expect(deduplicateLines([])).toEqual([]);
  });
});

describe('extractFirstErrorTimestamp', () => {
  it('should extract ISO timestamp before an ERROR keyword', () => {
    const lines = [
      '2024-01-15T14:32:01.123Z INFO starting up',
      '2024-01-15T14:32:05.456Z ERROR connection refused to postgres:5432',
      '2024-01-15T14:32:06.000Z ERROR retry 1'
    ];
    const ts = extractFirstErrorTimestamp(lines);
    expect(ts).toBe('2024-01-15T14:32:05.456Z');
  });

  it('should return null when no error lines found', () => {
    const lines = ['INFO starting', 'DEBUG loading config'];
    expect(extractFirstErrorTimestamp(lines)).toBeNull();
  });

  it('should match FATAL and Exception as error indicators', () => {
    const lines = ['2024-03-01T10:00:00Z FATAL NullPointerException'];
    expect(extractFirstErrorTimestamp(lines)).toBe('2024-03-01T10:00:00Z');
  });
});

describe('trimStackTrace', () => {
  it('should trim a long Node.js stack trace keeping top 3 and bottom 1', () => {
    const input = [
      'Error: connect ECONNREFUSED',
      '    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1148)',
      '    at Object.connect (net.js:295)',
      '    at Socket.connect (net.js:843)',
      '    at createConnection (net.js:200)',
      '    at appStart (/app/index.js:42)',
      '    at Object.<anonymous> (/app/index.js:100)'
    ];
    const result = trimStackTrace(input);
    // first non-stack line + top 3 stack frames + ellipsis + bottom 1
    expect(result[0]).toBe('Error: connect ECONNREFUSED');
    expect(result[1]).toContain('afterConnect');
    expect(result[2]).toContain('Object.connect');
    expect(result[3]).toContain('Socket.connect');
    expect(result[4]).toMatch(/\.\.\. \d+ frames trimmed/);
    expect(result[5]).toContain('index.js:100');
    expect(result).toHaveLength(6);
  });

  it('should not modify a short stack trace (≤4 frames)', () => {
    const input = ['Error: oops', '    at foo (/app/a.js:1)', '    at bar (/app/b.js:2)'];
    expect(trimStackTrace(input)).toEqual(input);
  });

  it('should not modify logs without a stack trace', () => {
    const input = ['INFO starting', 'ERROR bad config'];
    expect(trimStackTrace(input)).toEqual(input);
  });
});

describe('preprocessLogs', () => {
  it('should return empty string for empty input', () => {
    expect(preprocessLogs('')).toBe('');
  });

  it('should deduplicate and trim in a single pass', () => {
    const raw = [
      '2024-01-01T00:00:01Z ERROR db down',
      '2024-01-01T00:00:01Z ERROR db down',
      '2024-01-01T00:00:01Z ERROR db down',
      'retrying...'
    ].join('\n');

    const result = preprocessLogs(raw);
    expect(result).toContain('[repeated 3x]');
    expect(result).toContain('retrying...');
    // original repeated lines collapsed
    expect(result.split('\n').filter(l => l.includes('ERROR db down'))).toHaveLength(1);
  });

  it('should prepend first-error comment when timestamp found', () => {
    const raw = ['2024-06-01T09:15:00Z INFO boot', '2024-06-01T09:15:05Z ERROR failed to connect'].join('\n');

    const result = preprocessLogs(raw);
    expect(result).toContain('<!-- first-error: 2024-06-01T09:15:05Z -->');
  });

  it('should trim a long stack trace', () => {
    const frames = Array.from({ length: 8 }, (_, i) => `    at fn${i} (/app/file.js:${i})`);
    const raw = ['Error: boom', ...frames].join('\n');
    const result = preprocessLogs(raw);
    expect(result).toContain('frames trimmed');
  });
});
