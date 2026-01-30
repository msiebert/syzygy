/**
 * LogEntryRow - Individual log entry display
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { LogEntry, LogLevel } from '../../logs/log-entry.types.js';

interface LogEntryRowProps {
  entry: LogEntry;
  maxWidth: number;
}

/**
 * Get color for log level
 */
function getLevelColor(level: LogLevel): 'red' | 'yellow' | 'cyan' | 'gray' {
  switch (level) {
    case 'error':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'info':
      return 'cyan';
    case 'debug':
      return 'gray';
  }
}

/**
 * Format timestamp as HH:MM:SS
 */
function formatTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format log level as uppercase padded string
 */
function formatLevel(level: LogLevel): string {
  return level.toUpperCase().padEnd(5);
}

/**
 * LogEntryRow component
 */
export function LogEntryRow({ entry, maxWidth }: LogEntryRowProps): React.JSX.Element {
  const levelColor = getLevelColor(entry.level);
  const timestamp = formatTimestamp(entry.timestamp);
  const level = formatLevel(entry.level);

  // Calculate prefix length: [HH:MM:SS] LEVEL [agent-id]
  // Format: "[HH:MM:SS] LEVEL [agent-id] message"
  const prefix = `[${timestamp}] ${level} [${entry.agentId}] `;
  const prefixLength = prefix.length;

  // Calculate available space for message
  const availableWidth = Math.max(10, maxWidth - prefixLength);
  let message = entry.message;

  // Truncate message if needed
  if (message.length > availableWidth) {
    message = message.slice(0, availableWidth - 3) + '...';
  }

  return (
    <Box>
      <Text dimColor>[{timestamp}]</Text>
      <Text> </Text>
      <Text color={levelColor}>{level}</Text>
      <Text> </Text>
      <Text color="blue">[{entry.agentId}]</Text>
      <Text> </Text>
      <Text>{message}</Text>
    </Box>
  );
}
