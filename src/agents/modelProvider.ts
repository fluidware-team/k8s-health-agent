import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getLogger } from '@fluidware-it/saddlebag';

// Returns ChatAnthropic if ANTHROPIC_API_KEY is set, otherwise falls back to ChatOllama
export function getChatModel(): BaseChatModel {
  // eslint-disable-next-line n/no-process-env
  if (process.env.ANTHROPIC_API_KEY) {
    getLogger().info('Using Anthropic model');
    return new ChatAnthropic({
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0
    });
  }
  getLogger().info('Using Ollama model');
  return new ChatOllama({
    model: 'gpt-oss', // qwen3-coder
    temperature: 0
  });
}
