/**
 * Tmux pane-based PM interaction
 * Opens PM session in a split pane within the same terminal
 */

import { createModuleLogger } from './logger.js';
import type { SessionName } from '../types/agent.types.js';
import {
  isInsideTmux,
  splitAndAttachSession,
  type PaneId,
} from './tmux-utils.js';

const logger = createModuleLogger('terminal-window');

/**
 * Result of opening PM in a pane
 */
export interface PMPaneResult {
  /** The pane ID if opened successfully, null if not inside tmux */
  paneId: PaneId | null;
  /** Whether the pane was opened */
  opened: boolean;
  /** Manual attach command if not inside tmux */
  manualAttachCommand?: string;
}

/**
 * Open PM session in a tmux pane (side-by-side with Syzygy status)
 *
 * If running inside tmux, splits the current pane horizontally and attaches
 * the PM tmux session to the new pane.
 *
 * If not running inside tmux, returns instructions for manual attachment.
 *
 * @param sessionName - The tmux session name to attach to
 * @returns Result containing pane ID or manual attach instructions
 */
export async function openPMInPane(sessionName: SessionName): Promise<PMPaneResult> {
  logger.info({ sessionName }, 'Attempting to open PM in tmux pane');

  if (!isInsideTmux()) {
    logger.warn('Not running inside tmux, cannot split pane');
    const manualAttachCommand = `tmux attach -t ${sessionName}`;
    return {
      paneId: null,
      opened: false,
      manualAttachCommand,
    };
  }

  try {
    // Use split-window with tmux attach to display the PM session in a new pane.
    // This is more reliable than join-pane for detached sessions, which fail
    // with "size missing" because detached sessions lack terminal dimensions.
    const paneId = await splitAndAttachSession(sessionName, 'horizontal', 50);

    logger.info({ sessionName, paneId }, 'PM pane opened successfully');
    return {
      paneId,
      opened: true,
    };
  } catch (error) {
    logger.error({ error, sessionName }, 'Failed to open PM pane');
    // Fall back to manual attach instructions
    const manualAttachCommand = `tmux attach -t ${sessionName}`;
    return {
      paneId: null,
      opened: false,
      manualAttachCommand,
    };
  }
}
