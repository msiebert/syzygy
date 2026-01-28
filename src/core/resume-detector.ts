/**
 * Detect resumable workflow state from pending artifacts
 */

import { readFileSync } from 'node:fs';
import type { StageName } from '../types/stage.types.js';
import type { AgentRole } from '../types/agent.types.js';
import type { WorkflowState, ResumeState } from '../types/workflow.types.js';
import type { StageManager } from '../stages/stage-manager.js';
import type { LockManager } from '../stages/lock-manager.js';
import { parseArtifact } from '../utils/markdown-parser.js';
import { createSlug } from '../utils/sanitize.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('resume-detector');

/**
 * Stage to workflow state mapping
 * Returns the workflow state when artifacts are pending in this stage
 */
const STAGE_TO_STATE: Record<StageName, WorkflowState> = {
  spec: 'spec_pending',      // Architect processes spec
  arch: 'arch_pending',      // Test engineer processes arch
  tasks: 'impl_pending',     // Developer processes tasks
  tests: 'impl_pending',     // Developer processes tests
  impl: 'review_pending',    // Code reviewer processes impl
  review: 'docs_pending',    // Documenter processes review
  docs: 'docs_pending',      // Documenter processes docs
};

/**
 * Stage to required agents mapping
 * These are the agents needed when resuming from a given stage
 */
const STAGE_TO_AGENTS: Record<StageName, AgentRole[]> = {
  spec: ['architect', 'test-engineer', 'developer', 'code-reviewer', 'documenter'],
  arch: ['test-engineer', 'developer', 'code-reviewer', 'documenter'],
  tasks: ['developer', 'code-reviewer', 'documenter'],
  tests: ['developer', 'code-reviewer', 'documenter'],
  impl: ['code-reviewer', 'documenter'],
  review: ['documenter'],
  docs: ['documenter'],
};

/**
 * Stage processing order (earliest first)
 */
const STAGE_ORDER: StageName[] = ['spec', 'arch', 'tasks', 'tests', 'impl', 'review', 'docs'];

export class ResumeDetector {
  constructor(
    private stageManager: StageManager,
    private lockManager: LockManager
  ) {}

  /**
   * Detect resumable workflow state from pending artifacts
   */
  async detectResumableState(workspaceRoot: string): Promise<ResumeState> {
    logger.info({ workspaceRoot }, 'Detecting resumable workflow state');

    // Initialize stages if needed
    if (!this.stageManager.isInitialized()) {
      await this.stageManager.initializeStages(workspaceRoot);
    }

    // Get all pending artifacts across stages
    const pendingArtifacts = await this.stageManager.listAllPendingArtifacts();

    // Check if there's any pending work
    const hasPendingWork = this.checkForPendingWork(pendingArtifacts);

    if (!hasPendingWork) {
      logger.info('No pending work found');
      return {
        hasPendingWork: false,
        featureName: null,
        featureSlug: null,
        resumeFromState: 'idle',
        pendingArtifacts,
        staleLocksCleanedUp: 0,
        requiredAgents: [],
      };
    }

    // Collect all artifact paths for stale lock cleanup
    const allArtifactPaths = this.collectAllArtifactPaths(pendingArtifacts);

    // Clean up stale locks
    const staleLocksCleanedUp = await this.lockManager.cleanupStaleLocks(allArtifactPaths);
    if (staleLocksCleanedUp > 0) {
      logger.info({ staleLocksCleanedUp }, 'Cleaned up stale locks');
    }

    // Determine earliest stage with pending work
    const earliestStage = this.findEarliestStageWithPending(pendingArtifacts);

    if (!earliestStage) {
      logger.warn('No earliest stage found despite having pending work');
      return {
        hasPendingWork: false,
        featureName: null,
        featureSlug: null,
        resumeFromState: 'idle',
        pendingArtifacts,
        staleLocksCleanedUp,
        requiredAgents: [],
      };
    }

    // Extract feature name from first artifact
    const featureName = await this.extractFeatureName(pendingArtifacts, earliestStage);

    // Determine resume state and required agents
    const resumeFromState = STAGE_TO_STATE[earliestStage];
    const requiredAgents = STAGE_TO_AGENTS[earliestStage];

    logger.info(
      { earliestStage, resumeFromState, featureName, requiredAgents },
      'Detected resumable state'
    );

    return {
      hasPendingWork: true,
      featureName,
      featureSlug: featureName ? createSlug(featureName) : null,
      resumeFromState,
      pendingArtifacts,
      staleLocksCleanedUp,
      requiredAgents,
    };
  }

  /**
   * Check if there's any pending work
   */
  private checkForPendingWork(pendingArtifacts: Map<StageName, string[]>): boolean {
    for (const artifacts of pendingArtifacts.values()) {
      if (artifacts.length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Collect all artifact paths from the pending map
   */
  private collectAllArtifactPaths(pendingArtifacts: Map<StageName, string[]>): string[] {
    const paths: string[] = [];
    for (const artifacts of pendingArtifacts.values()) {
      paths.push(...artifacts);
    }
    return paths;
  }

  /**
   * Find the earliest stage with pending artifacts
   */
  private findEarliestStageWithPending(pendingArtifacts: Map<StageName, string[]>): StageName | null {
    for (const stage of STAGE_ORDER) {
      const artifacts = pendingArtifacts.get(stage);
      if (artifacts && artifacts.length > 0) {
        return stage;
      }
    }
    return null;
  }

  /**
   * Extract feature name from the first artifact in the earliest stage
   */
  private async extractFeatureName(
    pendingArtifacts: Map<StageName, string[]>,
    earliestStage: StageName
  ): Promise<string | null> {
    const artifacts = pendingArtifacts.get(earliestStage);
    if (!artifacts || artifacts.length === 0) {
      return null;
    }

    // Log warning if multiple features detected
    if (artifacts.length > 1) {
      logger.warn(
        { stage: earliestStage, count: artifacts.length },
        'Multiple artifacts in pending - using first one for feature name'
      );
    }

    const firstArtifactPath = artifacts[0];

    // Should never happen due to length check above, but TypeScript needs this
    if (firstArtifactPath === undefined) {
      return null;
    }

    try {
      const content = readFileSync(firstArtifactPath, 'utf-8');
      const artifact = parseArtifact(firstArtifactPath, content);
      return artifact.frontmatter.featureName;
    } catch (error) {
      logger.warn({ path: firstArtifactPath, error }, 'Failed to parse artifact for feature name');
      return null;
    }
  }
}
