/**
 * Manage stage directories and file movement
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from 'node:fs';
import type { Stage, StageName } from '../types/stage.types.js';
import type { AgentRole } from '../types/agent.types.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('stage-manager');

export class StageError extends Error {
  constructor(
    message: string,
    public readonly stageName?: string | undefined,
    public readonly context?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.name = 'StageError';
  }
}

export class StageManager {
  private stages: Map<StageName, Stage> = new Map();
  private workspaceRoot: string = '';

  /**
   * Initialize stage directories
   */
  async initializeStages(workspaceRoot: string): Promise<void> {
    logger.info({ workspaceRoot }, 'Initializing stages');

    this.workspaceRoot = workspaceRoot;
    const stagesDir = join(workspaceRoot, 'stages');

    // Define all stages according to the workflow
    const stageDefinitions: Array<{
      name: StageName;
      inputRole: AgentRole;
      outputRole: AgentRole;
    }> = [
      { name: 'spec', inputRole: 'architect', outputRole: 'product-manager' },
      { name: 'arch', inputRole: 'test-engineer', outputRole: 'architect' },
      { name: 'tasks', inputRole: 'developer', outputRole: 'architect' },
      { name: 'tests', inputRole: 'developer', outputRole: 'test-engineer' },
      { name: 'impl', inputRole: 'code-reviewer', outputRole: 'developer' },
      { name: 'review', inputRole: 'documenter', outputRole: 'code-reviewer' },
      { name: 'docs', inputRole: 'product-manager', outputRole: 'documenter' },
    ];

    try {
      // Create base stages directory
      if (!existsSync(stagesDir)) {
        mkdirSync(stagesDir, { recursive: true });
        logger.info({ stagesDir }, 'Created stages directory');
      }

      // Create each stage's pending and done directories
      for (const def of stageDefinitions) {
        const stagePath = join(stagesDir, def.name);
        const pendingDir = join(stagePath, 'pending');
        const doneDir = join(stagePath, 'done');

        // Create directories
        if (!existsSync(pendingDir)) {
          mkdirSync(pendingDir, { recursive: true });
          logger.debug({ pendingDir }, 'Created pending directory');
        }

        if (!existsSync(doneDir)) {
          mkdirSync(doneDir, { recursive: true });
          logger.debug({ doneDir }, 'Created done directory');
        }

        // Register stage
        const stage: Stage = {
          name: def.name,
          pendingDir,
          doneDir,
          inputRole: def.inputRole,
          outputRole: def.outputRole,
        };

        this.stages.set(def.name, stage);
        logger.debug({ stage }, 'Registered stage');
      }

      logger.info({ count: this.stages.size }, 'Stages initialized successfully');
    } catch (error) {
      logger.error({ workspaceRoot, error }, 'Failed to initialize stages');
      throw new StageError(
        'Failed to initialize stages',
        undefined,
        { workspaceRoot, error: String(error) }
      );
    }
  }

  /**
   * Move artifact from one location to another
   */
  async moveArtifact(
    fromPath: string,
    toPath: string
  ): Promise<void> {
    logger.info({ fromPath, toPath }, 'Moving artifact');

    try {
      if (!existsSync(fromPath)) {
        throw new StageError(
          'Source file does not exist',
          undefined,
          { fromPath }
        );
      }

      // Ensure destination directory exists
      const toDir = join(toPath, '..');
      if (!existsSync(toDir)) {
        mkdirSync(toDir, { recursive: true });
      }

      // Move file
      renameSync(fromPath, toPath);

      logger.info({ fromPath, toPath }, 'Artifact moved successfully');
    } catch (error) {
      logger.error({ fromPath, toPath, error }, 'Failed to move artifact');
      throw new StageError(
        'Failed to move artifact',
        undefined,
        { fromPath, toPath, error: String(error) }
      );
    }
  }

  /**
   * List all pending artifacts in a stage
   */
  async listPendingArtifacts(stageName: StageName): Promise<string[]> {
    logger.debug({ stageName }, 'Listing pending artifacts');

    const stage = this.stages.get(stageName);
    if (!stage) {
      throw new StageError(
        `Stage not found: ${stageName}`,
        stageName
      );
    }

    try {
      if (!existsSync(stage.pendingDir)) {
        logger.warn({ stageName, pendingDir: stage.pendingDir }, 'Pending directory does not exist');
        return [];
      }

      const files = readdirSync(stage.pendingDir)
        .filter(file => {
          // Filter out lock files and hidden files
          if (file.startsWith('.') || file.endsWith('.lock')) {
            return false;
          }

          // Only include regular files (not directories)
          const fullPath = join(stage.pendingDir, file);
          try {
            return statSync(fullPath).isFile();
          } catch {
            return false;
          }
        })
        .map(file => join(stage.pendingDir, file));

      logger.debug({ stageName, count: files.length }, 'Listed pending artifacts');
      return files;
    } catch (error) {
      logger.error({ stageName, error }, 'Failed to list pending artifacts');
      throw new StageError(
        'Failed to list pending artifacts',
        stageName,
        { error: String(error) }
      );
    }
  }

  /**
   * Get stage by name
   */
  getStage(stageName: StageName): Stage | undefined {
    return this.stages.get(stageName);
  }

  /**
   * Get all stages
   */
  getAllStages(): Stage[] {
    return Array.from(this.stages.values());
  }

  /**
   * Get workspace root
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Check if stages are initialized
   */
  isInitialized(): boolean {
    return this.stages.size > 0 && this.workspaceRoot !== '';
  }
}
