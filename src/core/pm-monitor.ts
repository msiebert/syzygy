/**
 * PM Monitor - Polls PM output and extracts new messages
 */

import type { SessionName } from '../types/agent.types.js';
import { capturePane } from '../utils/tmux-utils.js';
import { createModuleLogger } from '@utils/logger';
import { access } from 'node:fs/promises';

const logger = createModuleLogger('pm-monitor');

export interface PMMonitorOptions {
  pollInterval?: number; // Polling interval in ms (default: 200ms)
  onNewMessage?: (message: string) => void;
  onSpecComplete?: () => void;
  featureName: string;
  featureSlug: string;
}

/**
 * Monitor PM tmux session output and extract new messages
 */
export class PMMonitor {
  private previousOutput = '';
  private sessionName: SessionName;
  private pollInterval: number;
  private isPolling = false;
  private pollTimer: NodeJS.Timeout | undefined;
  private onNewMessage: ((message: string) => void) | undefined;
  private onSpecComplete: (() => void) | undefined;
  private featureSlug: string;

  constructor(sessionName: SessionName, options: PMMonitorOptions) {
    this.sessionName = sessionName;
    this.pollInterval = options.pollInterval ?? 200; // 200ms for low latency
    this.onNewMessage = options.onNewMessage;
    this.onSpecComplete = options.onSpecComplete;
    this.featureSlug = options.featureSlug;

    logger.info(
      { sessionName, pollInterval: this.pollInterval },
      'PM monitor initialized'
    );
  }

  /**
   * Start polling PM output
   */
  async startPolling(): Promise<void> {
    if (this.isPolling) {
      logger.warn('PM monitor already polling');
      return;
    }

    logger.info('Starting PM output polling');
    this.isPolling = true;

    // Start polling loop
    this.scheduleNextPoll();
  }

  /**
   * Stop polling PM output
   */
  stopPolling(): void {
    if (!this.isPolling) {
      return;
    }

    logger.info('Stopping PM output polling');
    this.isPolling = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Schedule the next poll
   * @private
   */
  private scheduleNextPoll(): void {
    if (!this.isPolling) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      void this.pollOnce();
    }, this.pollInterval);
  }

  /**
   * Poll once and extract new messages
   * @private
   */
  private async pollOnce(): Promise<void> {
    try {
      // Capture current pane output
      const currentOutput = await capturePane(this.sessionName);

      // Extract diff (new lines only)
      const newContent = this.extractNewContent(currentOutput);

      if (newContent) {
        logger.debug({ newContentLength: newContent.length }, 'New content detected');
        this.onNewMessage?.(newContent);
      }

      // Check for spec file
      const specExists = await this.checkSpecFile();
      if (specExists) {
        logger.info('Spec file detected, PM work complete');
        this.onSpecComplete?.();
        // Stop polling after spec is complete
        this.stopPolling();
        return;
      }

      this.previousOutput = currentOutput;
    } catch (error) {
      logger.error({ error }, 'Error polling PM output');
    }

    // Schedule next poll
    this.scheduleNextPoll();
  }

  /**
   * Extract new content from output using line-based comparison
   * @private
   */
  private extractNewContent(currentOutput: string): string | null {
    const currentLines = currentOutput.split('\n');
    const previousLines = this.previousOutput.split('\n');

    // Find where content diverges
    let commonPrefix = 0;
    while (
      commonPrefix < previousLines.length &&
      commonPrefix < currentLines.length &&
      currentLines[commonPrefix] === previousLines[commonPrefix]
    ) {
      commonPrefix++;
    }

    // Return new lines after common prefix
    const newLines = currentLines.slice(commonPrefix);
    return newLines.length > 0 ? newLines.join('\n') : null;
  }

  /**
   * Check if spec file exists
   * @private
   */
  private async checkSpecFile(): Promise<boolean> {
    const specPath = `.syzygy/stages/spec/pending/${this.featureSlug}-spec.md`;
    try {
      await access(specPath);
      return true;
    } catch {
      return false;
    }
  }
}
