import React from 'react';
import { render } from 'ink';
import { App } from '../tui/App';
import { processUserInput, createChatSession } from './chatMode';
import { listPodsTool, listNodesTool, listEventsTool } from '../tools/triageTools';
import type { ResourceStatus } from '../tui/components/ResourcesWindow';

export interface TuiModeOptions {
  namespace: string;
  context: string;
  modelSpec?: string | undefined;
}

export async function runTuiMode(options: TuiModeOptions): Promise<void> {
  const chatSession = createChatSession({
    namespace: options.namespace,
    context: options.context,
    modelSpec: options.modelSpec,
  });

  // Chat handler
  const handleChat = async (message: string): Promise<string> => {
    return processUserInput(chatSession, message);
  };

  // Refresh handler
  const handleRefresh = async (): Promise<void> => {
    // Fetch latest cluster state
    await listPodsTool.invoke({ namespace: options.namespace });
    await listNodesTool.invoke({});
    await listEventsTool.invoke({ namespace: options.namespace });
  };

  // Render the TUI
  const { waitUntilExit } = render(
    React.createElement(App, {
      namespace: options.namespace,
      context: options.context,
      onChat: handleChat,
      onRefresh: handleRefresh,
    })
  );

  // Wait for the app to exit
  await waitUntilExit();
}
