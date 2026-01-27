import * as dotenv from 'dotenv';
import { getLogger } from '@fluidware-it/saddlebag';
import { getDiagnosticGraph, stateToCheckpointData, resetDiagnosticGraph } from './agents/diagnosticGraph';
import { parseArgs } from './cli/parser';
import { getDefaultCheckpointer } from './persistence/fileCheckpointer';
import { getContextManager, listContexts, getCurrentContext, switchContext } from './cluster/contextManager';
import { runChatMode } from './cli/chatMode';
import { runTuiMode } from './cli/tuiMode';

dotenv.config();

const logger = getLogger();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkpointer = getDefaultCheckpointer();

  logger.info('Starting k8s-health-agent');

  // Handle context switching if specified
  if (args.context) {
    const availableContexts = listContexts();
    if (!availableContexts.includes(args.context)) {
      logger.error(`Context "${args.context}" not found. Available contexts: ${availableContexts.join(', ')}`);
      process.exit(1);
    }
    switchContext(args.context);
    logger.info(`Using context: ${args.context}`);
  } else {
    logger.info(`Using current context: ${getCurrentContext()}`);
  }

  // Initialize context manager (validates K8s connection)
  const contextManager = getContextManager(args.context);

  // TUI mode
  if (args.tui) {
    logger.info('Entering TUI mode...');
    await runTuiMode({
      namespace: args.namespace,
      context: contextManager.getCurrentContextName(),
      modelSpec: args.model,
    });
    return;
  }

  // Chat mode
  if (args.chat) {
    logger.info('Entering chat mode...');
    await runChatMode({
      namespace: args.namespace,
      context: args.context,
      modelSpec: args.model,
    });
    return;
  }

  // Generate thread ID for this diagnostic session
  const threadId = `${args.namespace}-${Date.now()}`;

  // Check for resume
  if (args.resume) {
    const latest = await checkpointer.getLatest();
    if (latest) {
      logger.info(`Resuming previous session: ${latest.threadId}`);
      logger.info(`Saved at: ${latest.savedAt.toISOString()}`);
      logger.info(`Namespace: ${latest.data.namespace}`);

      // Show previous findings
      if (latest.data.triageResult) {
        const issues = latest.data.triageResult.issues;
        logger.info(`Previous session found ${issues.length} issue(s)`);
      }

      // For now, just show the previous session - future: actually resume graph execution
      return;
    } else {
      logger.info('No previous session found. Starting fresh diagnostic.');
    }
  }

  logger.info(`--- Namespace Analysis: ${args.namespace} ---`);
  logger.info(`Context: ${contextManager.getCurrentContextName()}`);
  logger.info('Using multi-phase diagnostic graph (Triage -> Deep Dive -> Summary)');

  // Reset the graph singleton to ensure fresh state
  resetDiagnosticGraph();

  // Run the diagnostic graph with thread ID for LangGraph checkpointing
  const graph = getDiagnosticGraph();
  const result = await graph.invoke(
    { namespace: args.namespace },
    { configurable: { thread_id: threadId } }
  );

  // Save checkpoint to file
  const checkpointData = stateToCheckpointData(result);
  await checkpointer.save(threadId, checkpointData);
  logger.info(`Session saved with ID: ${threadId}`);

  // The summary node already prints the formatted report
  // Log completion
  logger.info(`\nDiagnostic complete. Found ${result.issues.length} issue(s).`);
}

main().catch((e: any) => {
  // eslint-disable-next-line no-console
  console.log(e);
  logger.error(e);
});
