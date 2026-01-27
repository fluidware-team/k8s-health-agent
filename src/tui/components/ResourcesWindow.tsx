import React from 'react';
import { Box, Text } from 'ink';

export interface ResourceStatus {
  name: string;
  kind: 'Pod' | 'Node' | 'Deployment';
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  details?: string | undefined;
}

export interface ResourcesWindowProps {
  resources: ResourceStatus[];
  title?: string | undefined;
}

export function ResourcesWindow({ resources, title = 'Resources' }: ResourcesWindowProps): React.ReactElement {
  const statusColor = {
    healthy: 'green',
    warning: 'yellow',
    critical: 'red',
    unknown: 'gray',
  };

  const statusIcon = {
    healthy: '●',
    warning: '▲',
    critical: '✗',
    unknown: '?',
  };

  const groupedResources = resources.reduce((acc, resource) => {
    if (!acc[resource.kind]) {
      acc[resource.kind] = [];
    }
    acc[resource.kind]!.push(resource);
    return acc;
  }, {} as Record<string, ResourceStatus[]>);

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>
      {Object.keys(groupedResources).length === 0 ? (
        <Text color="gray">No resources loaded...</Text>
      ) : (
        Object.entries(groupedResources).map(([kind, items]) => (
          <Box key={kind} flexDirection="column" marginBottom={1}>
            <Text bold color="white">{kind}s:</Text>
            {items.map((resource, i) => (
              <Box key={i} marginLeft={2}>
                <Text color={statusColor[resource.status]}>
                  {statusIcon[resource.status]}{' '}
                </Text>
                <Text>{resource.name}</Text>
                {resource.details && (
                  <Text color="gray"> - {resource.details}</Text>
                )}
              </Box>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}
