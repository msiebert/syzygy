/**
 * Unit tests for lock-manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LockManager, LockError } from '../../src/stages/lock-manager.js';

describe('LockManager', () => {
  const testDir = join(import.meta.dir, '../.tmp/lock-manager-test');
  const taskPath = join(testDir, 'test-task.md');
  const lockPath = `${taskPath}.lock`;
  let lockManager: LockManager;

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create test task file
    Bun.write(taskPath, 'test task content');

    lockManager = new LockManager();
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('claimTask', () => {
    it('should successfully claim an unlocked task', async () => {
      const claimed = await lockManager.claimTask(taskPath, 'agent-1');

      expect(claimed).toBe(true);
      expect(existsSync(lockPath)).toBe(true);
    });

    it('should fail to claim an already locked task', async () => {
      // First claim
      const firstClaim = await lockManager.claimTask(taskPath, 'agent-1');
      expect(firstClaim).toBe(true);

      // Second claim should fail
      const secondClaim = await lockManager.claimTask(taskPath, 'agent-2');
      expect(secondClaim).toBe(false);
    });

    it('should write correct lock file data', async () => {
      await lockManager.claimTask(taskPath, 'agent-1');

      const lockData = await lockManager.getLockInfo(taskPath);

      expect(lockData).not.toBeNull();
      expect(lockData?.agentId).toBe('agent-1');
      expect(lockData?.pid).toBe(process.pid);
      expect(lockData?.claimedAt).toBeTruthy();
    });
  });

  describe('releaseLock', () => {
    it('should successfully release a lock', async () => {
      await lockManager.claimTask(taskPath, 'agent-1');
      expect(existsSync(lockPath)).toBe(true);

      await lockManager.releaseLock(taskPath);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should not throw when releasing a non-existent lock', async () => {
      await expect(lockManager.releaseLock(taskPath)).resolves.toBeUndefined();
    });
  });

  describe('isLocked', () => {
    it('should return true for locked task', async () => {
      await lockManager.claimTask(taskPath, 'agent-1');

      const locked = await lockManager.isLocked(taskPath);
      expect(locked).toBe(true);
    });

    it('should return false for unlocked task', async () => {
      const locked = await lockManager.isLocked(taskPath);
      expect(locked).toBe(false);
    });
  });

  describe('getLockInfo', () => {
    it('should return lock info for locked task', async () => {
      await lockManager.claimTask(taskPath, 'agent-1');

      const info = await lockManager.getLockInfo(taskPath);

      expect(info).not.toBeNull();
      expect(info?.agentId).toBe('agent-1');
      expect(info?.pid).toBe(process.pid);
    });

    it('should return null for unlocked task', async () => {
      const info = await lockManager.getLockInfo(taskPath);
      expect(info).toBeNull();
    });

    it('should throw LockError for corrupted lock file', async () => {
      // Create corrupted lock file
      await Bun.write(lockPath, 'invalid json{');

      await expect(lockManager.getLockInfo(taskPath)).rejects.toThrow(LockError);
    });
  });

  describe('cleanupStaleLocks', () => {
    it('should not remove locks for running processes', async () => {
      await lockManager.claimTask(taskPath, 'agent-1');

      const cleaned = await lockManager.cleanupStaleLocks([taskPath]);

      expect(cleaned).toBe(0);
      expect(existsSync(lockPath)).toBe(true);
    });

    it('should remove locks for non-existent processes', async () => {
      // Create lock with fake PID
      const fakeLockData = {
        agentId: 'agent-1',
        claimedAt: new Date().toISOString(),
        pid: 999999, // Very unlikely to exist
      };
      await Bun.write(lockPath, JSON.stringify(fakeLockData));

      const cleaned = await lockManager.cleanupStaleLocks([taskPath]);

      expect(cleaned).toBe(1);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should handle multiple task paths', async () => {
      const task2Path = join(testDir, 'task2.md');
      const task3Path = join(testDir, 'task3.md');

      await Bun.write(task2Path, 'content');
      await Bun.write(task3Path, 'content');

      // Create locks with fake PIDs
      await Bun.write(`${task2Path}.lock`, JSON.stringify({
        agentId: 'agent-1',
        claimedAt: new Date().toISOString(),
        pid: 999998,
      }));

      await Bun.write(`${task3Path}.lock`, JSON.stringify({
        agentId: 'agent-2',
        claimedAt: new Date().toISOString(),
        pid: 999997,
      }));

      const cleaned = await lockManager.cleanupStaleLocks([task2Path, task3Path]);

      expect(cleaned).toBe(2);
    });

    it('should skip unlocked tasks', async () => {
      const cleaned = await lockManager.cleanupStaleLocks([taskPath]);

      expect(cleaned).toBe(0);
    });
  });
});
