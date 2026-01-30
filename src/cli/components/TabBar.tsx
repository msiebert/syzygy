/**
 * TabBar - Tab navigation component
 */

import React from 'react';
import { Box, Text } from 'ink';

export type TabId = 'chat' | 'logs' | 'status';

interface TabBarProps {
  activeTab: TabId;
  hasLogErrors: boolean;
}

interface TabConfig {
  id: TabId;
  label: string;
}

const TABS: readonly TabConfig[] = [
  { id: 'chat', label: 'PM Chat' },
  { id: 'logs', label: 'Logs' },
  { id: 'status', label: 'Status' },
] as const;

/**
 * TabBar component showing available tabs
 */
export function TabBar({ activeTab, hasLogErrors }: TabBarProps): React.JSX.Element {
  return (
    <Box flexDirection="row" marginBottom={1}>
      {TABS.map((tab, index) => {
        const isActive = tab.id === activeTab;
        const showBadge = tab.id === 'logs' && hasLogErrors && !isActive;

        return (
          <Box key={tab.id} marginRight={1}>
            {index > 0 && <Text dimColor> | </Text>}
            {isActive ? (
              <Text bold color="cyan">
                [{tab.label}]
              </Text>
            ) : (
              <Text dimColor>
                {tab.label}
                {showBadge && <Text color="red"> *</Text>}
              </Text>
            )}
          </Box>
        );
      })}
      <Box flexGrow={1} />
      <Text dimColor>Tab/Shift+Tab to switch</Text>
    </Box>
  );
}
