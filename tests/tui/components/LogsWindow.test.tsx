import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LogsWindow, type LogEntry } from '../../../src/tui/components/LogsWindow';

describe('LogsWindow', () => {
  it('should render title', () => {
    const { lastFrame } = render(
      <LogsWindow logs={[]} title="Test Logs" />
    );

    expect(lastFrame()).toContain('Test Logs');
  });

  it('should show empty state when no logs', () => {
    const { lastFrame } = render(
      <LogsWindow logs={[]} />
    );

    expect(lastFrame()).toContain('No logs yet');
  });

  it('should render log entries', () => {
    const logs: LogEntry[] = [
      { timestamp: '10:00:00', level: 'info', message: 'Application started' },
      { timestamp: '10:00:01', level: 'warn', message: 'Low memory warning' },
    ];

    const { lastFrame } = render(
      <LogsWindow logs={logs} />
    );

    expect(lastFrame()).toContain('Application started');
    expect(lastFrame()).toContain('Low memory warning');
    expect(lastFrame()).toContain('[INFO]');
    expect(lastFrame()).toContain('[WARN]');
  });

  it('should limit displayed logs based on maxLines', () => {
    const logs: LogEntry[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `10:00:${i.toString().padStart(2, '0')}`,
      level: 'info' as const,
      message: `Log entry number ${i + 1} here`,
    }));

    const { lastFrame } = render(
      <LogsWindow logs={logs} maxLines={5} />
    );

    // Should show only the last 5 logs (16-20)
    expect(lastFrame()).toContain('Log entry number 16 here');
    expect(lastFrame()).toContain('Log entry number 20 here');
    // Check that earlier log (5) is not shown - use unique identifier
    expect(lastFrame()).not.toContain('number 5 here');
  });

  it('should render error level logs', () => {
    const logs: LogEntry[] = [
      { timestamp: '10:00:00', level: 'error', message: 'Connection failed' },
    ];

    const { lastFrame } = render(
      <LogsWindow logs={logs} />
    );

    expect(lastFrame()).toContain('[ERROR]');
    expect(lastFrame()).toContain('Connection failed');
  });

  it('should render debug level logs', () => {
    const logs: LogEntry[] = [
      { timestamp: '10:00:00', level: 'debug', message: 'Debug info' },
    ];

    const { lastFrame } = render(
      <LogsWindow logs={logs} />
    );

    expect(lastFrame()).toContain('[DEBUG]');
    expect(lastFrame()).toContain('Debug info');
  });
});
