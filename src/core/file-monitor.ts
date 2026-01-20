/**
 * File system monitoring for stage directories
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { FileMonitorError } from '../types/message.types.js';
import type { WorkflowEvent, ArtifactPayload } from '../types/workflow.types.js';
import { createModuleLogger } from '@utils/logger';
import path from 'path';

const logger = createModuleLogger('file-monitor');

type EventListener = (event: WorkflowEvent) => void;

export interface FileMonitorOptions {
  debounceMs?: number;      // Debounce delay in milliseconds (default: 100)
  ignoreInitial?: boolean;  // Ignore initial add events (default: true)
}

export class FileMonitor {
  private watcher: FSWatcher | undefined;
  private listeners: Map<string, EventListener[]> = new Map();
  private watchPaths: string[] = [];
  private options: Required<FileMonitorOptions>;
  private isStarted = false;

  constructor(options: FileMonitorOptions = {}) {
    this.options = {
      debounceMs: options.debounceMs ?? 100,
      ignoreInitial: options.ignoreInitial ?? true,
    };

    logger.info({ options: this.options }, 'FileMonitor initialized');
  }

  /**
   * Add a path to watch
   */
  addWatchPath(watchPath: string): void {
    if (this.isStarted) {
      throw new FileMonitorError(
        'Cannot add watch paths after monitor has started',
        watchPath
      );
    }

    this.watchPaths.push(watchPath);
    logger.debug({ watchPath }, 'Watch path added');
  }

  /**
   * Start monitoring files
   */
  start(): void {
    if (this.isStarted) {
      logger.warn('FileMonitor already started');
      return;
    }

    if (this.watchPaths.length === 0) {
      throw new FileMonitorError(
        'No watch paths configured',
        'start',
        { watchPaths: this.watchPaths }
      );
    }

    logger.info(
      { watchPaths: this.watchPaths, options: this.options },
      'Starting file monitor'
    );

    try {
      this.watcher = chokidar.watch(this.watchPaths, {
        ignoreInitial: this.options.ignoreInitial,
        awaitWriteFinish: {
          stabilityThreshold: this.options.debounceMs,
          pollInterval: 50,
        },
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/*.lock', // Ignore lock files
          '**/.*',     // Ignore hidden files (except directories)
        ],
      });

      this.watcher.on('add', (filePath) => this.handleFileAdded(filePath));
      this.watcher.on('change', (filePath) => this.handleFileModified(filePath));
      this.watcher.on('unlink', (filePath) => this.handleFileDeleted(filePath));
      this.watcher.on('error', (error) => this.handleError(error));

      this.isStarted = true;

      logger.info('File monitor started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start file monitor');
      throw new FileMonitorError(
        'Failed to start file monitor',
        'start',
        { originalError: error }
      );
    }
  }

  /**
   * Stop monitoring files
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      logger.warn('FileMonitor not started');
      return;
    }

    logger.info('Stopping file monitor');

    try {
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = undefined;
      }

      this.isStarted = false;

      logger.info('File monitor stopped successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to stop file monitor');
      throw new FileMonitorError(
        'Failed to stop file monitor',
        'stop',
        { originalError: error }
      );
    }
  }

  /**
   * Register an event listener
   */
  on(eventType: string, listener: EventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    this.listeners.get(eventType)!.push(listener);

    logger.debug({ eventType }, 'Event listener registered');
  }

  /**
   * Unregister an event listener
   */
  off(eventType: string, listener: EventListener): void {
    const listeners = this.listeners.get(eventType);

    if (!listeners) {
      return;
    }

    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
      logger.debug({ eventType }, 'Event listener unregistered');
    }
  }

  /**
   * Handle file added event
   */
  private handleFileAdded(filePath: string): void {
    logger.debug({ filePath }, 'File added');

    const stageName = this.extractStageName(filePath);

    if (!stageName) {
      logger.debug({ filePath }, 'Could not extract stage name, ignoring');
      return;
    }

    const payload: ArtifactPayload = {
      artifactPath: filePath,
      stageName,
    };

    this.emit({
      type: 'artifact:created',
      timestamp: new Date(),
      payload,
    });
  }

  /**
   * Handle file modified event
   */
  private handleFileModified(filePath: string): void {
    logger.debug({ filePath }, 'File modified');

    const stageName = this.extractStageName(filePath);

    if (!stageName) {
      logger.debug({ filePath }, 'Could not extract stage name, ignoring');
      return;
    }

    const payload: ArtifactPayload = {
      artifactPath: filePath,
      stageName,
    };

    this.emit({
      type: 'artifact:modified',
      timestamp: new Date(),
      payload,
    });
  }

  /**
   * Handle file deleted event
   */
  private handleFileDeleted(filePath: string): void {
    logger.debug({ filePath }, 'File deleted');

    const stageName = this.extractStageName(filePath);

    if (!stageName) {
      logger.debug({ filePath }, 'Could not extract stage name, ignoring');
      return;
    }

    const payload: ArtifactPayload = {
      artifactPath: filePath,
      stageName,
    };

    this.emit({
      type: 'artifact:deleted',
      timestamp: new Date(),
      payload,
    });
  }

  /**
   * Handle watcher error
   */
  private handleError(error: unknown): void {
    logger.error({ error }, 'File watcher error');

    // Note: We don't throw here because chokidar errors are often recoverable
    // Instead, we log the error and continue monitoring
  }

  /**
   * Extract stage name from file path
   * Example: .syzygy/stages/spec/pending/feature.md -> "spec"
   */
  private extractStageName(filePath: string): string | undefined {
    const normalized = path.normalize(filePath);
    const parts = normalized.split(path.sep);

    // Look for "stages" directory
    const stagesIndex = parts.indexOf('stages');

    if (stagesIndex === -1 || stagesIndex + 1 >= parts.length) {
      return undefined;
    }

    // Stage name is the directory after "stages"
    return parts[stagesIndex + 1];
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: WorkflowEvent): void {
    const listeners = this.listeners.get(event.type);

    if (!listeners || listeners.length === 0) {
      logger.debug({ eventType: event.type }, 'No listeners for event');
      return;
    }

    logger.debug(
      { eventType: event.type, listenerCount: listeners.length },
      'Emitting event to listeners'
    );

    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error(
          { eventType: event.type, error },
          'Error in event listener'
        );
      }
    }
  }

  /**
   * Check if monitor is running
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Get configured watch paths
   */
  getWatchPaths(): string[] {
    return [...this.watchPaths];
  }
}
