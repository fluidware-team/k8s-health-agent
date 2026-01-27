import { createAgent } from 'langchain';
import { listNodesTool, listPodsTool, readPodLogsTool, listEventsTool } from '../tools/k8sTools';
import { ChatAnthropic } from '@langchain/anthropic';
import { SystemMessage } from '@langchain/core/messages';
import { DIAGNOSTIC_SYSTEM_PROMPT } from '../prompts/systemPrompt';
import { ChatOllama } from '@langchain/ollama';

export const getAgent = () => {
  let model;
  // eslint-disable-next-line n/no-process-env
  if (process.env.ANTHROPIC_API_KEY) {
    model = new ChatAnthropic({
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0
    });
  } else {
    model = new ChatOllama({
      model: 'gpt-oss', // qwen3-coder
      temperature: 0
    });
  }

  const tools = [listPodsTool, listNodesTool, readPodLogsTool, listEventsTool];

  // Create the agent with tools
  return createAgent({
    model,
    tools
  });
};

// Export system message for use in the conversation
export const getSystemMessage = () => new SystemMessage(DIAGNOSTIC_SYSTEM_PROMPT);
