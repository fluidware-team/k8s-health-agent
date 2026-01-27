import * as dotenv from 'dotenv';
import { getAgent, getSystemMessage } from './agents/k8sAgent';
import { HumanMessage } from '@langchain/core/messages';
import { getLogger } from '@fluidware-it/saddlebag';
import { buildUserPrompt } from './prompts/systemPrompt';

dotenv.config();

const logger = getLogger();
logger.info('Starting app');

async function main() {
  const namespace = process.argv[2] || 'default';

  logger.info(`--- Namespace Analysis: ${namespace} ---`);

  const input = {
    messages: [getSystemMessage(), new HumanMessage(buildUserPrompt(namespace))]
  };

  const result = await getAgent().invoke(input);

  // The last message in the list is the AI's final response
  const lastMessage = result.messages[result.messages.length - 1];
  logger.info('\nAGENT REPORT:');
  // eslint-disable-next-line no-console
  console.log(lastMessage?.content);
}

main().catch((e: any) => {
  // eslint-disable-next-line no-console
  console.log(e);
  logger.error(e);
});
