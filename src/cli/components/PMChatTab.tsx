/**
 * PMChatTab - Placeholder for PM chat functionality
 */

import React from 'react';
import { Box, Text } from 'ink';

/**
 * PMChatTab placeholder component
 */
export function PMChatTab(): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          PM Chat
        </Text>
      </Box>
      <Box>
        <Text dimColor>Coming soon - PM interaction will be available here</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          For now, use the separate PM terminal window to interact with the
          Product Manager.
        </Text>
      </Box>
    </Box>
  );
}
