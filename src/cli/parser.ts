export interface CliArgs {
  namespace: string;
  context?: string | undefined;
  resume: boolean;
  chat: boolean;
  tui: boolean;
  model?: string | undefined;
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    namespace: 'default',
    context: undefined,
    resume: false,
    chat: false,
    tui: false,
    model: undefined,
  };

  const positionalArgs: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // Handle --context or -c
    if (arg === '--context' || arg === '-c') {
      result.context = args[i + 1];
      i += 2;
      continue;
    }

    // Handle --context=value
    if (arg?.startsWith('--context=')) {
      result.context = arg.split('=')[1];
      i++;
      continue;
    }

    // Handle --resume or -r
    if (arg === '--resume' || arg === '-r') {
      result.resume = true;
      i++;
      continue;
    }

    // Handle --chat
    if (arg === '--chat') {
      result.chat = true;
      i++;
      continue;
    }

    // Handle --tui
    if (arg === '--tui') {
      result.tui = true;
      i++;
      continue;
    }

    // Handle --model or -m
    if (arg === '--model' || arg === '-m') {
      result.model = args[i + 1];
      i += 2;
      continue;
    }

    // Handle --model=value
    if (arg?.startsWith('--model=')) {
      result.model = arg.split('=')[1];
      i++;
      continue;
    }

    // Collect positional arguments
    if (arg && !arg.startsWith('-')) {
      positionalArgs.push(arg);
    }

    i++;
  }

  // First positional argument is the namespace
  if (positionalArgs.length > 0) {
    result.namespace = positionalArgs[0]!;
  }

  return result;
}
