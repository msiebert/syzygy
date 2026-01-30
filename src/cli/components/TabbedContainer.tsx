/**
 * TabbedContainer - Container with tab navigation
 */

import React, { useEffect } from 'react';
import { Box, useInput } from 'ink';
import { TabBar, type TabId } from './TabBar.js';

const TAB_ORDER: readonly TabId[] = ['chat', 'logs', 'status'] as const;

interface TabbedContainerProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasLogErrors: boolean;
  onLogsViewed: () => void;
  children: React.ReactNode;
  /** Set to true to disable tab key handling (when filter bar is open) */
  captureTabKey?: boolean;
}

/**
 * Get the next tab in the cycle
 */
function getNextTab(current: TabId): TabId {
  const currentIndex = TAB_ORDER.indexOf(current);
  const nextIndex = (currentIndex + 1) % TAB_ORDER.length;
  return TAB_ORDER[nextIndex] ?? 'chat';
}

/**
 * Get the previous tab in the cycle
 */
function getPrevTab(current: TabId): TabId {
  const currentIndex = TAB_ORDER.indexOf(current);
  const prevIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
  return TAB_ORDER[prevIndex] ?? 'chat';
}

/**
 * TabbedContainer with keyboard navigation
 */
export function TabbedContainer({
  activeTab,
  onTabChange,
  hasLogErrors,
  onLogsViewed,
  children,
  captureTabKey = false,
}: TabbedContainerProps): React.JSX.Element {
  // Handle tab key navigation
  useInput((_input, key) => {
    // If tab key capture is disabled (filter bar open), ignore tab
    if (captureTabKey) {
      return;
    }

    if (key.tab) {
      const newTab = key.shift ? getPrevTab(activeTab) : getNextTab(activeTab);

      // Notify if switching TO logs tab
      if (newTab === 'logs' && activeTab !== 'logs') {
        onLogsViewed();
      }

      onTabChange(newTab);
    }
  });

  // Mark errors as read when viewing logs tab
  useEffect(() => {
    if (activeTab === 'logs') {
      onLogsViewed();
    }
  }, [activeTab, onLogsViewed]);

  return (
    <Box flexDirection="column" height="100%">
      <TabBar activeTab={activeTab} hasLogErrors={hasLogErrors} />
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
}

export type { TabId };
