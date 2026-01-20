/**
 * Unit tests for stage-manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StageManager, StageError } from '../../src/stages/stage-manager.js';
import type { StageName } from '../../src/types/stage.types.js';

describe('StageManager', () => {
  const testDir = join(import.meta.dir, '../.tmp/stage-manager-test');
  let stageManager: StageManager;

  beforeEach(() => {
    // Clean and create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    stageManager = new StageManager();
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initializeStages', () => {
    it('should create all stage directories', async () => {
      await stageManager.initializeStages(testDir);

      const stageNames: StageName[] = ['spec', 'arch', 'tasks', 'tests', 'impl', 'review', 'docs'];

      for (const stageName of stageNames) {
        const pendingDir = join(testDir, 'stages', stageName, 'pending');
        const doneDir = join(testDir, 'stages', stageName, 'done');

        expect(existsSync(pendingDir)).toBe(true);
        expect(existsSync(doneDir)).toBe(true);
      }
    });

    it('should register all stages', async () => {
      await stageManager.initializeStages(testDir);

      const stages = stageManager.getAllStages();
      expect(stages.length).toBe(7);
    });

    it('should set workspace root', async () => {
      await stageManager.initializeStages(testDir);

      expect(stageManager.getWorkspaceRoot()).toBe(testDir);
      expect(stageManager.isInitialized()).toBe(true);
    });

    it('should not fail if directories already exist', async () => {
      // Initialize once
      await stageManager.initializeStages(testDir);

      // Initialize again
      await expect(stageManager.initializeStages(testDir)).resolves.toBeUndefined();
    });
  });

  describe('getStage', () => {
    beforeEach(async () => {
      await stageManager.initializeStages(testDir);
    });

    it('should return stage by name', () => {
      const stage = stageManager.getStage('spec');

      expect(stage).toBeDefined();
      expect(stage?.name).toBe('spec');
      expect(stage?.inputRole).toBe('architect');
      expect(stage?.outputRole).toBe('product-manager');
    });

    it('should return undefined for non-existent stage', () => {
      const stage = stageManager.getStage('invalid' as StageName);

      expect(stage).toBeUndefined();
    });
  });

  describe('getAllStages', () => {
    beforeEach(async () => {
      await stageManager.initializeStages(testDir);
    });

    it('should return all stages', () => {
      const stages = stageManager.getAllStages();

      expect(stages.length).toBe(7);
      expect(stages.map(s => s.name)).toEqual([
        'spec',
        'arch',
        'tasks',
        'tests',
        'impl',
        'review',
        'docs',
      ]);
    });
  });

  describe('listPendingArtifacts', () => {
    beforeEach(async () => {
      await stageManager.initializeStages(testDir);
    });

    it('should list all pending artifacts in a stage', async () => {
      const pendingDir = join(testDir, 'stages', 'spec', 'pending');

      // Create test artifacts
      writeFileSync(join(pendingDir, 'artifact1.md'), 'content1');
      writeFileSync(join(pendingDir, 'artifact2.md'), 'content2');
      writeFileSync(join(pendingDir, 'artifact3.md'), 'content3');

      const artifacts = await stageManager.listPendingArtifacts('spec');

      expect(artifacts.length).toBe(3);
      expect(artifacts.every(p => p.endsWith('.md'))).toBe(true);
    });

    it('should exclude lock files', async () => {
      const pendingDir = join(testDir, 'stages', 'spec', 'pending');

      writeFileSync(join(pendingDir, 'artifact1.md'), 'content');
      writeFileSync(join(pendingDir, 'artifact1.md.lock'), 'lock content');

      const artifacts = await stageManager.listPendingArtifacts('spec');

      expect(artifacts.length).toBe(1);
      expect(artifacts[0]).toMatch(/artifact1\.md$/);
    });

    it('should exclude hidden files', async () => {
      const pendingDir = join(testDir, 'stages', 'spec', 'pending');

      writeFileSync(join(pendingDir, 'artifact.md'), 'content');
      writeFileSync(join(pendingDir, '.hidden'), 'hidden content');

      const artifacts = await stageManager.listPendingArtifacts('spec');

      expect(artifacts.length).toBe(1);
    });

    it('should exclude directories', async () => {
      const pendingDir = join(testDir, 'stages', 'spec', 'pending');

      writeFileSync(join(pendingDir, 'artifact.md'), 'content');
      mkdirSync(join(pendingDir, 'subdir'));

      const artifacts = await stageManager.listPendingArtifacts('spec');

      expect(artifacts.length).toBe(1);
    });

    it('should return empty array if no artifacts', async () => {
      const artifacts = await stageManager.listPendingArtifacts('spec');

      expect(artifacts).toEqual([]);
    });

    it('should throw StageError for non-existent stage', async () => {
      await expect(
        stageManager.listPendingArtifacts('invalid' as StageName)
      ).rejects.toThrow(StageError);
    });
  });

  describe('moveArtifact', () => {
    beforeEach(async () => {
      await stageManager.initializeStages(testDir);
    });

    it('should move artifact from pending to done', async () => {
      const pendingPath = join(testDir, 'stages', 'spec', 'pending', 'artifact.md');
      const donePath = join(testDir, 'stages', 'spec', 'done', 'artifact.md');

      // Create artifact in pending
      writeFileSync(pendingPath, 'content');

      await stageManager.moveArtifact(pendingPath, donePath);

      expect(existsSync(pendingPath)).toBe(false);
      expect(existsSync(donePath)).toBe(true);
    });

    it('should create destination directory if it does not exist', async () => {
      const fromPath = join(testDir, 'stages', 'spec', 'pending', 'artifact.md');
      const toPath = join(testDir, 'new-dir', 'subdir', 'artifact.md');

      writeFileSync(fromPath, 'content');

      await stageManager.moveArtifact(fromPath, toPath);

      expect(existsSync(toPath)).toBe(true);
    });

    it('should throw StageError if source does not exist', async () => {
      const fromPath = join(testDir, 'nonexistent.md');
      const toPath = join(testDir, 'dest.md');

      await expect(stageManager.moveArtifact(fromPath, toPath)).rejects.toThrow(StageError);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(stageManager.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await stageManager.initializeStages(testDir);

      expect(stageManager.isInitialized()).toBe(true);
    });
  });

  describe('getWorkspaceRoot', () => {
    it('should return empty string before initialization', () => {
      expect(stageManager.getWorkspaceRoot()).toBe('');
    });

    it('should return workspace root after initialization', async () => {
      await stageManager.initializeStages(testDir);

      expect(stageManager.getWorkspaceRoot()).toBe(testDir);
    });
  });
});
