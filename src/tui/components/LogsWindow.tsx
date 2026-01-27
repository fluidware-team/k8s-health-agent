import React from 'react';
import { Box, Text } from 'ink';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface LogsWindowProps {
  logs: LogEntry[];
  title?: string | undefined;
  maxLines?: number | undefined;
}

export function LogsWindow({ logs, title = 'Logs', maxLines = 10 }: LogsWindowProps): React.ReactElement {
  const displayLogs = logs.slice(-maxLines);

  const levelColor = {
    info: 'blue',
    warn: 'yellow',
    error: 'red',
    debug: 'gray',
  };

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>
      {displayLogs.length === 0 ? (
        <Text color="gray">No logs yet...</Text>
      ) : (
        displayLogs.map((log, i) => (
          <Box key={i}>
            <Text color="gray">[{log.timestamp}] </Text>
            <Text color={levelColor[log.level]}>[{log.level.toUpperCase()}] </Text>
            <Text>{log.message}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
