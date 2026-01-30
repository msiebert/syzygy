/**
 * LogsTab - Full log viewer component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { logStore } from '../../logs/log-store.js';
import { parseFilter, type LogFilterCriteria } from '../../logs/log-filter.js';
import type { LogEntry } from '../../logs/log-entry.types.js';
import { FilterBar } from './FilterBar.js';
import { LogEntryRow } from './LogEntryRow.js';

interface LogsTabProps {
  isActive: boolean;
  terminalHeight: number;
  terminalWidth: number;
}

/**
 * LogsTab component with filtering and scrolling
 */
export function LogsTab({
  isActive,
  terminalHeight,
  terminalWidth,
}: LogsTabProps): React.JSX.Element {
  // Filter state
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [appliedFilter, setAppliedFilter] = useState<LogFilterCriteria>({});
  const [filterError, setFilterError] = useState<string | undefined>(undefined);

  // Scroll state
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // Log entries state
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [version, setVersion] = useState(0);

  // Subscribe to log store updates
  useEffect(() => {
    const unsubscribe = logStore.subscribe(() => {
      setVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);

  // Update entries when version changes
  useEffect(() => {
    const allEntries = logStore.getEntries();
    setEntries(allEntries);
  }, [version]);

  // Get filtered entries
  const filteredEntries = logStore.getFilteredEntries(appliedFilter);
  const hasFilter = Object.keys(appliedFilter).length > 0;

  // Calculate visible area (reserve lines for header/footer)
  const headerLines = 2; // Tab bar + filter info
  const footerLines = filterBarOpen ? 3 : 1;
  const visibleLines = Math.max(1, terminalHeight - headerLines - footerLines);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && filteredEntries.length > 0) {
      const maxOffset = Math.max(0, filteredEntries.length - visibleLines);
      setScrollOffset(maxOffset);
    }
  }, [filteredEntries.length, autoScroll, visibleLines]);

  // Get visible entries
  const visibleEntries = filteredEntries.slice(
    scrollOffset,
    scrollOffset + visibleLines
  );

  // Handle filter bar
  const openFilterBar = useCallback(() => {
    setFilterBarOpen(true);
    setFilterError(undefined);
  }, []);

  const closeFilterBar = useCallback(() => {
    setFilterBarOpen(false);
    setFilterError(undefined);
  }, []);

  const applyFilterFromText = useCallback(() => {
    const result = parseFilter(filterText);
    if (result.isValid) {
      setAppliedFilter(result.criteria);
      setFilterBarOpen(false);
      setFilterError(undefined);
    } else {
      setFilterError(result.error);
    }
  }, [filterText]);

  const clearFilter = useCallback(() => {
    setFilterText('');
    setAppliedFilter({});
    setFilterBarOpen(false);
    setFilterError(undefined);
  }, []);

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isActive) {
        return;
      }

      // Filter bar is open - let FilterBar handle input
      if (filterBarOpen) {
        return;
      }

      // Open filter bar with /
      if (input === '/') {
        openFilterBar();
        return;
      }

      // Clear filter with Escape when not in filter bar
      if (key.escape && hasFilter) {
        clearFilter();
        return;
      }

      // Scroll navigation
      if (key.upArrow) {
        setAutoScroll(false);
        setScrollOffset((o) => Math.max(0, o - 1));
        return;
      }

      if (key.downArrow) {
        const maxOffset = Math.max(0, filteredEntries.length - visibleLines);
        setScrollOffset((o) => Math.min(maxOffset, o + 1));
        // Re-enable auto-scroll if at bottom
        if (scrollOffset >= maxOffset - 1) {
          setAutoScroll(true);
        }
        return;
      }

      // Page Up
      if (key.pageUp) {
        setAutoScroll(false);
        setScrollOffset((o) => Math.max(0, o - visibleLines));
        return;
      }

      // Page Down
      if (key.pageDown) {
        const maxOffset = Math.max(0, filteredEntries.length - visibleLines);
        setScrollOffset((o) => Math.min(maxOffset, o + visibleLines));
        if (scrollOffset >= maxOffset - visibleLines) {
          setAutoScroll(true);
        }
        return;
      }

      // Home - go to top (g key)
      if (input === 'g') {
        setAutoScroll(false);
        setScrollOffset(0);
        return;
      }

      // End - go to bottom (G key)
      if (input === 'G') {
        const maxOffset = Math.max(0, filteredEntries.length - visibleLines);
        setScrollOffset(maxOffset);
        setAutoScroll(true);
        return;
      }
    },
    { isActive: isActive && !filterBarOpen }
  );

  // Empty state
  if (entries.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>No logs yet - waiting for agent activity...</Text>
        <Box marginTop={1}>
          <Text dimColor>Press / to open filter bar</Text>
        </Box>
      </Box>
    );
  }

  // No matches state
  if (hasFilter && filteredEntries.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <FilterBar
          value={filterText}
          onChange={setFilterText}
          onSubmit={applyFilterFromText}
          onCancel={closeFilterBar}
          isOpen={filterBarOpen}
          error={filterError}
        />
        <Text color="yellow">No logs match filter</Text>
        <Box marginTop={1}>
          <Text dimColor>/ to edit filter | Esc to clear</Text>
        </Box>
        {!filterBarOpen && hasFilter && (
          <Box marginTop={1}>
            <Text dimColor>
              Filter: {filterText || formatFilter(appliedFilter)}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Build log count display
  const totalCount = logStore.getTotalCount();
  const displayCount = filteredEntries.length;
  const countText = hasFilter
    ? `${displayCount} of ${totalCount} logs (filtered)`
    : `${displayCount} of ${totalCount} logs`;

  return (
    <Box flexDirection="column" height="100%">
      {/* Filter bar (when open) */}
      <FilterBar
        value={filterText}
        onChange={setFilterText}
        onSubmit={applyFilterFromText}
        onCancel={closeFilterBar}
        isOpen={filterBarOpen}
        error={filterError}
      />

      {/* Log entries */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleEntries.map((entry) => (
          <LogEntryRow key={entry.id} entry={entry} maxWidth={terminalWidth} />
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1} flexDirection="row">
        <Text dimColor>{countText}</Text>
        {!autoScroll && (
          <Text color="yellow"> | Scroll locked (press End to resume)</Text>
        )}
        {hasFilter && !filterBarOpen && (
          <Text dimColor> | Filter: {filterText}</Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Format filter criteria for display
 */
function formatFilter(criteria: LogFilterCriteria): string {
  const parts: string[] = [];
  if (criteria.textSearch !== undefined) {
    parts.push(criteria.textSearch);
  }
  if (criteria.agentId !== undefined) {
    parts.push(`agent:${criteria.agentId}`);
  }
  if (criteria.minLevel !== undefined) {
    parts.push(`level:${criteria.minLevel}`);
  }
  return parts.join(' ');
}
