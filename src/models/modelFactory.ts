import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ModelSpec {
  provider: 'openai' | 'ollama';
  model: string;
}

const DEFAULT_MODEL: ModelSpec = {
  provider: 'openai',
  model: 'gpt-4o-mini',
};

export function parseModelSpec(specString: string): ModelSpec {
  const parts = specString.split('/');

  // If no slash, assume OpenAI
  if (parts.length === 1) {
    return {
      provider: 'openai',
      model: specString,
    };
  }

  // First part is provider, rest is model name
  const provider = parts[0] as 'openai' | 'ollama';
  const model = parts.slice(1).join('/');

  return { provider, model };
}

export function createModel(spec?: string | ModelSpec): BaseChatModel {
  let modelSpec: ModelSpec;

  if (!spec) {
    modelSpec = DEFAULT_MODEL;
  } else if (typeof spec === 'string') {
    modelSpec = parseModelSpec(spec);
  } else {
    modelSpec = spec;
  }

  switch (modelSpec.provider) {
    case 'openai':
      return new ChatOpenAI({
        model: modelSpec.model,
        temperature: 0.1,
      });

    case 'ollama':
      return new ChatOllama({
        model: modelSpec.model,
        temperature: 0.1,
      });

    default:
      throw new Error(`Unsupported provider: ${(modelSpec as ModelSpec).provider}`);
  }
}

export function getModelDescription(spec: ModelSpec): string {
  return `${spec.provider}/${spec.model}`;
}
