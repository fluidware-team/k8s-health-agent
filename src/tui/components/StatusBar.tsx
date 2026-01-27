import React from 'react';
import { Box, Text } from 'ink';

export interface StatusBarProps {
  namespace: string;
  context: string;
  status: 'idle' | 'loading' | 'error' | 'success';
  message?: string | undefined;
}

export function StatusBar({ namespace, context, status, message }: StatusBarProps): React.ReactElement {
  const statusColor = {
    idle: 'gray',
    loading: 'yellow',
    error: 'red',
    success: 'green',
  }[status];

  const statusIcon = {
    idle: '○',
    loading: '◐',
    error: '✗',
    success: '✓',
  }[status];

  return (
    <Box
      borderStyle="single"
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Box>
        <Text color="cyan">Namespace: </Text>
        <Text bold>{namespace}</Text>
        <Text> | </Text>
        <Text color="cyan">Context: </Text>
        <Text bold>{context}</Text>
      </Box>
      <Box>
        <Text color={statusColor}>
          {statusIcon} {message || status}
        </Text>
      </Box>
    </Box>
  );
}
