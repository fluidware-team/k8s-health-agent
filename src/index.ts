import * as dotenv from 'dotenv';
import { getLogger } from '@fluidware-it/saddlebag';
import { getDiagnosticGraph } from './agents/diagnosticGraph';

dotenv.config();

const logger = getLogger();
logger.info('Starting app');

async function main() {
  const namespace = process.argv[2] || 'default';

  logger.info(`--- Namespace Analysis: ${namespace} ---`);
  logger.info('Using multi-phase diagnostic graph (Triage -> Deep Dive -> Summary)');

  // Run the diagnostic graph
  const result = await getDiagnosticGraph().invoke({ namespace });

  // The summary node already prints the formatted report
  // Log completion
  logger.info(`\nDiagnostic complete. Found ${result.issues.length} issue(s).`);
}

main().catch((e: any) => {
  // eslint-disable-next-line no-console
  console.log(e);
  logger.error(e);
});
