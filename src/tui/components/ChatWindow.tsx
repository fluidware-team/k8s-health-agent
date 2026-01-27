import React from 'react';
import { Box, Text } from 'ink';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string | undefined;
}

export interface ChatWindowProps {
  messages: ChatMessage[];
  title?: string | undefined;
  maxMessages?: number | undefined;
}

export function ChatWindow({ messages, title = 'Chat', maxMessages = 20 }: ChatWindowProps): React.ReactElement {
  const displayMessages = messages.slice(-maxMessages);

  const roleColor = {
    user: 'green',
    assistant: 'blue',
    system: 'gray',
  };

  const roleLabel = {
    user: 'You',
    assistant: 'Agent',
    system: 'System',
  };

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>
      {displayMessages.length === 0 ? (
        <Text color="gray">Start a conversation...</Text>
      ) : (
        displayMessages.map((msg, i) => (
          <Box key={i} marginBottom={1} flexDirection="column">
            <Box>
              <Text color={roleColor[msg.role]} bold>
                {roleLabel[msg.role]}:
              </Text>
              {msg.timestamp && (
                <Text color="gray"> [{msg.timestamp}]</Text>
              )}
            </Box>
            <Box marginLeft={2}>
              <Text wrap="wrap">{msg.content}</Text>
            </Box>
          </Box>
        ))
      )}
    </Box>
  );
}
