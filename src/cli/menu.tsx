/**
 * Interactive main menu using Ink
 */

import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('menu');

export type MenuChoice = 'new-feature' | 'resume-workflow' | 'settings' | 'exit';

interface MenuItem {
  label: string;
  value: MenuChoice;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'New Feature', value: 'new-feature' },
  { label: 'Resume Workflow', value: 'resume-workflow' },
  { label: 'Settings', value: 'settings' },
  { label: 'Exit', value: 'exit' },
];

interface MenuProps {
  onSelect: (choice: MenuChoice) => void;
}

/**
 * Main menu component
 */
function Menu({ onSelect }: MenuProps): React.JSX.Element {
  const handleSelect = (item: MenuItem) => {
    logger.info({ choice: item.value }, 'Menu item selected');
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╔════════════════════════════════════════╗
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ║         SYZYGY ORCHESTRATOR            ║
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╚════════════════════════════════════════╝
        </Text>
      </Box>

      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>Multi-agent development workflow</Text>
      </Box>

      <Box marginTop={1}>
        <SelectInput items={MENU_ITEMS} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

/**
 * Show main menu and wait for user selection
 */
export function showMenu(): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const handleSelect = (choice: MenuChoice) => {
      // Unmount the menu
      app.unmount();
      resolve(choice);
    };

    const app = render(<Menu onSelect={handleSelect} />);
  });
}

/**
 * Display a simple message box
 */
interface MessageBoxProps {
  title: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}

function MessageBox({ title, message, type = 'info' }: MessageBoxProps): React.JSX.Element {
  const colors = {
    info: 'blue',
    success: 'green',
    error: 'red',
    warning: 'yellow',
  } as const;

  const icons = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  } as const;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor={colors[type]}>
      <Box marginBottom={1}>
        <Text bold color={colors[type]}>
          {icons[type]} {title}
        </Text>
      </Box>
      <Box>
        <Text>{message}</Text>
      </Box>
    </Box>
  );
}

/**
 * Show a message and wait for user to press any key
 */
export function showMessage(
  title: string,
  message: string,
  type: 'info' | 'success' | 'error' | 'warning' = 'info'
): Promise<void> {
  return new Promise((resolve) => {
    const handleInput = () => {
      app.unmount();
      resolve();
    };

    const MessageWithInput = () => {
      useState(() => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', handleInput);
      });

      return (
        <Box flexDirection="column">
          <MessageBox title={title} message={message} type={type} />
          <Box marginTop={1}>
            <Text dimColor>Press any key to continue...</Text>
          </Box>
        </Box>
      );
    };

    const app = render(<MessageWithInput />);
  });
}

/**
 * Display a loading spinner
 */
interface LoadingProps {
  message: string;
}

function Loading({ message }: LoadingProps): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  useState(() => {
    const interval = setInterval(() => {
      setFrame((prev: number) => (prev + 1) % frames.length);
    }, 80);

    return () => clearInterval(interval);
  });

  return (
    <Box>
      <Text color="cyan">{frames[frame]} </Text>
      <Text>{message}</Text>
    </Box>
  );
}

/**
 * Show loading spinner
 */
export function showLoading(message: string): { stop: () => void } {
  const app = render(<Loading message={message} />);

  return {
    stop: () => {
      app.unmount();
    },
  };
}
