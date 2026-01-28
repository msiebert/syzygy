/**
 * PM Monitor - Polls for spec file completion
 * Simplified: Only watches for spec file existence
 */

import type { SessionName } from '../types/agent.types.js';
import { createModuleLogger } from '@utils/logger';
import { access } from 'node:fs/promises';

const logger = createModuleLogger('pm-monitor');

export interface PMMonitorOptions {
  pollInterval?: number; // Polling interval in ms (default: 1000ms)
  onSpecComplete?: () => void;
  featureName: string;
  featureSlug: string;
}

/**
 * Monitor for PM spec file completion
 * Simplified to just watch for spec file existence
 */
export class PMMonitor {
  private pollInterval: number;
  private isPolling = false;
  private pollTimer: NodeJS.Timeout | undefined;
  private onSpecComplete: (() => void) | undefined;
  private featureSlug: string;

  constructor(sessionName: SessionName, options: PMMonitorOptions) {
    this.pollInterval = options.pollInterval ?? 1000; // 1s polling for spec detection
    this.onSpecComplete = options.onSpecComplete;
    this.featureSlug = options.featureSlug;

    logger.info(
      { sessionName, pollInterval: this.pollInterval },
      'PM monitor initialized'
    );
  }

  /**
   * Start polling for spec file
   */
  async startPolling(): Promise<void> {
    if (this.isPolling) {
      logger.warn('PM monitor already polling');
      return;
    }

    logger.info('Starting PM spec file polling');
    this.isPolling = true;

    // Start polling loop
    this.scheduleNextPoll();
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (!this.isPolling) {
      return;
    }

    logger.info('Stopping PM spec file polling');
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
   * Poll once for spec file existence
   * @private
   */
  private async pollOnce(): Promise<void> {
    try {
      // Check for spec file
      const specExists = await this.checkSpecFile();
      if (specExists) {
        logger.info('Spec file detected, PM work complete');
        this.onSpecComplete?.();
        // Stop polling after spec is complete
        this.stopPolling();
        return;
      }
    } catch (error) {
      logger.error({ error }, 'Error polling for spec file');
    }

    // Schedule next poll
    this.scheduleNextPoll();
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
