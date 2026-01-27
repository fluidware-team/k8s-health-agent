import * as readline from 'readline';
import { getLogger } from '@fluidware-it/saddlebag';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createModel } from '../models/modelFactory';
import { getK8sDiagnosticPrompt, getChatSystemPrompt } from '../prompts/systemPrompt';
import { listPodsTool, listNodesTool, listEventsTool } from '../tools/triageTools';
import { readPodLogsTool, getPodMetricsTool } from '../tools/deepDiveTools';

const logger = getLogger();

export interface ChatSession {
  namespace: string;
  context?: string | undefined;
  model: BaseChatModel;
  messages: (HumanMessage | AIMessage | SystemMessage)[];
}

export interface ChatModeOptions {
  namespace: string;
  context?: string | undefined;
  modelSpec?: string | undefined;
}

const tools = [listPodsTool, listNodesTool, listEventsTool, readPodLogsTool, getPodMetricsTool];

export function createChatSession(options: ChatModeOptions): ChatSession {
  const model = createModel(options.modelSpec);
  const systemPrompt = getChatSystemPrompt(options.namespace);

  return {
    namespace: options.namespace,
    context: options.context,
    model,
    messages: [new SystemMessage(systemPrompt)],
  };
}

export async function processUserInput(session: ChatSession, input: string): Promise<string> {
  // Add user message to history
  session.messages.push(new HumanMessage(input));

  try {
    // Bind tools to the model
    const modelWithTools = session.model.bindTools(tools);

    // Get response from the model
    const response = await modelWithTools.invoke(session.messages);

    // Check if the model wants to call tools
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Process tool calls
      const toolResults: string[] = [];

      for (const toolCall of response.tool_calls) {
        const tool = tools.find(t => t.name === toolCall.name);
        if (tool) {
          try {
            const result = await tool.invoke(toolCall.args);
            toolResults.push(`[${toolCall.name}]: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
          } catch (error) {
            toolResults.push(`[${toolCall.name}]: Error - ${error}`);
          }
        }
      }

      // Add tool results context and get final response
      const toolContext = toolResults.join('\n\n');
      session.messages.push(new AIMessage(`I used the following tools:\n${toolContext}`));
      session.messages.push(new HumanMessage('Based on the tool results, please provide your analysis.'));

      const finalResponse = await session.model.invoke(session.messages);
      const content = typeof finalResponse.content === 'string' ? finalResponse.content : JSON.stringify(finalResponse.content);
      session.messages.push(new AIMessage(content));
      return content;
    }

    // No tool calls, just return the response
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    session.messages.push(new AIMessage(content));
    return content;
  } catch (error) {
    const errorMsg = `Error processing request: ${error}`;
    logger.error(errorMsg);
    return errorMsg;
  }
}

export async function runChatMode(options: ChatModeOptions): Promise<void> {
  const session = createChatSession(options);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n=== K8s Health Agent - Chat Mode ===');
  console.log(`Namespace: ${options.namespace}`);
  if (options.context) {
    console.log(`Context: ${options.context}`);
  }
  console.log('Type your questions about the cluster. Type "exit" or "quit" to leave.\n');

  const prompt = (): void => {
    rl.question('You: ', async (input) => {
      const trimmedInput = input.trim();

      if (trimmedInput.toLowerCase() === 'exit' || trimmedInput.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }

      if (!trimmedInput) {
        prompt();
        return;
      }

      console.log('\nAssistant: Thinking...');
      const response = await processUserInput(session, trimmedInput);
      console.log(`\nAssistant: ${response}\n`);

      prompt();
    });
  };

  prompt();

  // Handle readline close
  rl.on('close', () => {
    process.exit(0);
  });
}
