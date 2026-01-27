import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusBar } from '../../../src/tui/components/StatusBar';

describe('StatusBar', () => {
  it('should render namespace and context', () => {
    const { lastFrame } = render(
      <StatusBar
        namespace="production"
        context="prod-cluster"
        status="idle"
      />
    );

    expect(lastFrame()).toContain('production');
    expect(lastFrame()).toContain('prod-cluster');
  });

  it('should show idle status', () => {
    const { lastFrame } = render(
      <StatusBar
        namespace="default"
        context="local"
        status="idle"
      />
    );

    expect(lastFrame()).toContain('idle');
  });

  it('should show loading status', () => {
    const { lastFrame } = render(
      <StatusBar
        namespace="default"
        context="local"
        status="loading"
      />
    );

    expect(lastFrame()).toContain('loading');
  });

  it('should show error status', () => {
    const { lastFrame } = render(
      <StatusBar
        namespace="default"
        context="local"
        status="error"
      />
    );

    expect(lastFrame()).toContain('error');
  });

  it('should show success status', () => {
    const { lastFrame } = render(
      <StatusBar
        namespace="default"
        context="local"
        status="success"
      />
    );

    expect(lastFrame()).toContain('success');
  });

  it('should show custom message', () => {
    const { lastFrame } = render(
      <StatusBar
        namespace="default"
        context="local"
        status="loading"
        message="Fetching pods..."
      />
    );

    expect(lastFrame()).toContain('Fetching pods...');
  });
});
