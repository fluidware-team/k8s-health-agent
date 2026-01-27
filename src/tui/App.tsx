import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { StatusBar, type StatusBarProps } from './components/StatusBar';
import { LogsWindow, type LogEntry } from './components/LogsWindow';
import { ResourcesWindow, type ResourceStatus } from './components/ResourcesWindow';
import { ChatWindow, type ChatMessage } from './components/ChatWindow';

export interface AppProps {
  namespace: string;
  context: string;
  onChat?: ((message: string) => Promise<string>) | undefined;
  onRefresh?: (() => Promise<void>) | undefined;
}

type ViewMode = 'dashboard' | 'chat' | 'logs';

export function App({ namespace, context, onChat, onRefresh }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [status, setStatus] = useState<StatusBarProps['status']>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [resources, setResources] = useState<ResourceStatus[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Add a log entry
  const addLog = (level: LogEntry['level'], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, level, message }]);
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    if (!isProcessing) {
      // Tab to switch views
      if (key.tab) {
        const modes: ViewMode[] = ['dashboard', 'chat', 'logs'];
        const currentIndex = modes.indexOf(viewMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        setViewMode(modes[nextIndex]!);
        return;
      }

      // R to refresh
      if (input === 'r' && viewMode === 'dashboard' && onRefresh) {
        handleRefresh();
        return;
      }
    }
  });

  // Handle refresh
  const handleRefresh = async () => {
    if (!onRefresh) return;

    setIsProcessing(true);
    setStatus('loading');
    setStatusMessage('Refreshing...');
    addLog('info', 'Refreshing cluster data...');

    try {
      await onRefresh();
      setStatus('success');
      setStatusMessage('Refreshed');
      addLog('info', 'Refresh complete');
    } catch (error) {
      setStatus('error');
      setStatusMessage('Refresh failed');
      addLog('error', `Refresh failed: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle chat input
  const handleChatSubmit = async (value: string) => {
    if (!value.trim() || !onChat || isProcessing) return;

    setInputValue('');
    setIsProcessing(true);
    setStatus('loading');
    setStatusMessage('Thinking...');

    const userMessage: ChatMessage = {
      role: 'user',
      content: value,
      timestamp: new Date().toLocaleTimeString(),
    };
    setChatMessages(prev => [...prev, userMessage]);
    addLog('info', `User: ${value}`);

    try {
      const response = await onChat(value);
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        timestamp: new Date().toLocaleTimeString(),
      };
      setChatMessages(prev => [...prev, assistantMessage]);
      addLog('info', 'Agent responded');
      setStatus('success');
      setStatusMessage('Ready');
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: 'system',
        content: `Error: ${error}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setChatMessages(prev => [...prev, errorMessage]);
      addLog('error', `Chat error: ${error}`);
      setStatus('error');
      setStatusMessage('Error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Initial welcome message
  useEffect(() => {
    addLog('info', 'K8s Health Agent TUI started');
    addLog('info', `Monitoring namespace: ${namespace}`);
    setChatMessages([{
      role: 'system',
      content: `Welcome to K8s Health Agent. Monitoring namespace "${namespace}" on context "${context}". Use Tab to switch views, R to refresh, Esc to exit.`,
    }]);
  }, [namespace, context]);

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        namespace={namespace}
        context={context}
        status={status}
        message={statusMessage}
      />

      <Box marginY={1}>
        <Text color="gray">
          View: <Text color="cyan" bold>{viewMode}</Text>
          {' | '}
          <Text color="gray">[Tab] Switch | [R] Refresh | [Esc] Exit</Text>
        </Text>
      </Box>

      {viewMode === 'dashboard' && (
        <Box flexDirection="row" flexGrow={1}>
          <Box width="50%">
            <ResourcesWindow resources={resources} title="Cluster Resources" />
          </Box>
          <Box width="50%">
            <LogsWindow logs={logs} title="Activity Log" maxLines={15} />
          </Box>
        </Box>
      )}

      {viewMode === 'chat' && (
        <Box flexDirection="column" flexGrow={1}>
          <ChatWindow messages={chatMessages} title="Chat with Agent" />
          <Box borderStyle="single" paddingX={1}>
            <Text color="cyan">{'> '}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleChatSubmit}
              placeholder="Type your question..."
            />
          </Box>
        </Box>
      )}

      {viewMode === 'logs' && (
        <LogsWindow logs={logs} title="Full Activity Log" maxLines={30} />
      )}
    </Box>
  );
}
