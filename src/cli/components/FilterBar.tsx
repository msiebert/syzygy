/**
 * FilterBar - Filter input component for logs
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

interface FilterBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isOpen: boolean;
  error: string | undefined;
}

/**
 * FilterBar component for entering log filter text
 */
export function FilterBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  isOpen,
  error,
}: FilterBarProps): React.JSX.Element | null {
  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isOpen) {
        return;
      }

      if (key.return) {
        onSubmit();
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      // Ignore control characters
      if (key.ctrl || key.meta) {
        return;
      }

      // Add regular characters
      if (input && !key.tab) {
        onChange(value + input);
      }
    },
    { isActive: isOpen }
  );

  if (!isOpen) {
    return null;
  }

  const showPlaceholder = value === '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan">Filter: </Text>
        {showPlaceholder ? (
          <Text dimColor>Filter by text, agent:name, level:error</Text>
        ) : (
          <Text>{value}</Text>
        )}
        <Text color="cyan">|</Text>
      </Box>
      {error !== undefined && (
        <Box>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={0}>
        <Text dimColor>Enter to apply, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
