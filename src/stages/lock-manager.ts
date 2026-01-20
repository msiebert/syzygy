/**
 * Handle .lock files for task claiming
 */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import type { LockFile } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('lock-manager');

export class LockError extends Error {
  constructor(
    message: string,
    public readonly lockPath: string,
    public readonly context?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.name = 'LockError';
  }
}

export class LockManager {
  /**
   * Attempt to claim a task by creating a lock file
   * Returns true if lock was acquired, false if already locked
   */
  async claimTask(
    taskPath: string,
    agentId: string
  ): Promise<boolean> {
    const lockPath = `${taskPath}.lock`;
    logger.info({ taskPath, agentId, lockPath }, 'Attempting to claim task');

    try {
      const lockData: LockFile = {
        agentId,
        claimedAt: new Date().toISOString(),
        pid: process.pid,
      };

      // Use 'wx' flag for atomic exclusive creation
      // This will throw EEXIST if file already exists
      writeFileSync(lockPath, JSON.stringify(lockData, null, 2), { flag: 'wx' });

      logger.info({ taskPath, agentId, lockPath }, 'Task claimed successfully');
      return true;
    } catch (error) {
      // Check if error is due to file already existing (EEXIST)
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        logger.debug({ taskPath, agentId, lockPath }, 'Task already claimed by another agent');
        return false;
      }

      // Other errors should be thrown
      logger.error({ taskPath, agentId, lockPath, error }, 'Failed to claim task');
      throw error;
    }
  }

  /**
   * Release a task lock
   */
  async releaseLock(taskPath: string): Promise<void> {
    const lockPath = `${taskPath}.lock`;
    logger.info({ taskPath, lockPath }, 'Releasing lock');

    try {
      if (!existsSync(lockPath)) {
        logger.debug({ taskPath, lockPath }, 'Lock file does not exist, nothing to release');
        return;
      }

      unlinkSync(lockPath);
      logger.info({ taskPath, lockPath }, 'Lock released successfully');
    } catch (error) {
      logger.error({ taskPath, lockPath, error }, 'Failed to release lock');
      throw new LockError(
        'Failed to release lock',
        lockPath,
        { taskPath, error: String(error) }
      );
    }
  }

  /**
   * Check if a task is locked
   */
  async isLocked(taskPath: string): Promise<boolean> {
    const lockPath = `${taskPath}.lock`;
    logger.debug({ taskPath, lockPath }, 'Checking lock status');

    const locked = existsSync(lockPath);
    logger.debug({ taskPath, lockPath, locked }, 'Lock status checked');

    return locked;
  }

  /**
   * Get lock file information
   * Returns null if lock doesn't exist
   */
  async getLockInfo(taskPath: string): Promise<LockFile | null> {
    const lockPath = `${taskPath}.lock`;
    logger.debug({ taskPath, lockPath }, 'Getting lock info');

    try {
      if (!existsSync(lockPath)) {
        logger.debug({ taskPath, lockPath }, 'Lock file does not exist');
        return null;
      }

      const file = Bun.file(lockPath);
      const content = await file.text();
      const lockData = JSON.parse(content) as LockFile;

      logger.debug({ taskPath, lockPath, lockData }, 'Lock info retrieved');
      return lockData;
    } catch (error) {
      logger.error({ taskPath, lockPath, error }, 'Failed to read lock file');
      throw new LockError(
        'Failed to read lock file',
        lockPath,
        { taskPath, error: String(error) }
      );
    }
  }

  /**
   * Clean up stale locks (optional utility)
   * Removes locks for processes that no longer exist
   */
  async cleanupStaleLocks(taskPaths: string[]): Promise<number> {
    logger.info({ count: taskPaths.length }, 'Cleaning up stale locks');

    let cleaned = 0;

    for (const taskPath of taskPaths) {
      const lockInfo = await this.getLockInfo(taskPath);

      if (!lockInfo) {
        continue;
      }

      // Check if process still exists
      try {
        // Send signal 0 to check if process exists without killing it
        process.kill(lockInfo.pid, 0);
        logger.debug({ taskPath, pid: lockInfo.pid }, 'Process still running, keeping lock');
      } catch {
        // Process doesn't exist, remove stale lock
        logger.info({ taskPath, pid: lockInfo.pid }, 'Removing stale lock');
        await this.releaseLock(taskPath);
        cleaned++;
      }
    }

    logger.info({ cleaned, total: taskPaths.length }, 'Stale lock cleanup complete');
    return cleaned;
  }
}
