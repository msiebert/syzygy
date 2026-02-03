/**
 * Agent Completion Tracker
 *
 * Tracks agent work and detects completion based on file creation.
 * Instead of monitoring terminal output for markers, this module tracks
 * which output files each agent should produce. When those files appear
 * in the stage directories, the agent is considered complete.
 *
 * This is more reliable than terminal-based detection because:
 * - File creation is atomic and verifiable
 * - No fragile regex parsing of terminal output
 * - No false positives from echoed text
 * - Aligns with the workflow's file-based artifact passing design
 */

import type { AgentId, AgentRole } from '../types/agent.types.js';
import type { StageName } from '../types/stage.types.js';
import type { InstructionContext } from '../agents/agent-instructions.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('agent-completion-tracker');

/**
 * Represents expected output from an agent
 */
export interface ExpectedOutput {
  agentId: AgentId;
  role: AgentRole;
  stageName: StageName;
  filePattern: RegExp;
  startedAt: Date;
  featureSlug: string;
  taskId?: string | undefined;
}

/**
 * Completion event emitted when an agent's output file is detected
 */
export interface CompletionEvent {
  agentId: AgentId;
  role: AgentRole;
  artifactPath: string;
  stageName: StageName;
  completedAt: Date;
}

/**
 * Maps agent roles to their expected output stage and file patterns
 */
interface OutputPattern {
  stageName: StageName;
  filePatternFn: (featureSlug: string, taskId?: string) => RegExp;
}

/**
 * Output patterns by role.
 * Note: Code Reviewer can output to either review/ (approval) or tasks/ (fixes needed)
 */
const OUTPUT_PATTERNS: Record<AgentRole, OutputPattern[]> = {
  'product-manager': [
    {
      stageName: 'spec',
      filePatternFn: (featureSlug) => new RegExp(`^${escapeRegExp(featureSlug)}-spec\\.md$`),
    },
  ],
  'architect': [
    // Architect's completion is signaled by architecture.md
    // Task files should be written BEFORE architecture.md per instructions
    {
      stageName: 'arch',
      filePatternFn: (featureSlug) => new RegExp(`^${escapeRegExp(featureSlug)}-architecture\\.md$`),
    },
  ],
  'test-engineer': [
    {
      stageName: 'tests',
      filePatternFn: (featureSlug) => new RegExp(`^${escapeRegExp(featureSlug)}-tests\\.ts$`),
    },
  ],
  'developer': [
    {
      stageName: 'impl',
      filePatternFn: (featureSlug, taskId) => {
        const taskPart = taskId ? escapeRegExp(taskId) : 'task-\\d+';
        return new RegExp(`^${escapeRegExp(featureSlug)}-${taskPart}-implementation\\.md$`);
      },
    },
  ],
  'code-reviewer': [
    // Reviewer can output either an approval OR a fixes request
    {
      stageName: 'review',
      filePatternFn: (featureSlug, taskId) => {
        const taskPart = taskId ? escapeRegExp(taskId) : 'task-\\d+';
        return new RegExp(`^${escapeRegExp(featureSlug)}-${taskPart}-review\\.md$`);
      },
    },
    {
      stageName: 'tasks',
      filePatternFn: (featureSlug, taskId) => {
        const taskPart = taskId ? escapeRegExp(taskId) : 'task-\\d+';
        return new RegExp(`^${escapeRegExp(featureSlug)}-${taskPart}-fixes\\.md$`);
      },
    },
  ],
  'documenter': [
    {
      stageName: 'docs',
      filePatternFn: (featureSlug) => new RegExp(`^${escapeRegExp(featureSlug)}-documentation\\.md$`),
    },
  ],
};

/**
 * Escape a string for use in a RegExp
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the filename from a full path
 */
function extractFilename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * Agent Completion Tracker
 *
 * Tracks expected output files from agents and detects when they complete
 * their work by watching for file creation events.
 */
export class AgentCompletionTracker {
  /** Map of agent ID to their expected outputs */
  private pendingWork: Map<AgentId, ExpectedOutput[]> = new Map();

  constructor() {
    logger.info('AgentCompletionTracker initialized');
  }

  /**
   * Register that an agent is working and what output files to expect.
   *
   * @param agentId - The agent's ID
   * @param role - The agent's role
   * @param context - The instruction context containing feature info
   */
  registerWork(agentId: AgentId, role: AgentRole, context: InstructionContext): void {
    const patterns = OUTPUT_PATTERNS[role];
    if (!patterns || patterns.length === 0) {
      logger.warn({ agentId, role }, 'No output patterns defined for role');
      return;
    }

    const expectedOutputs: ExpectedOutput[] = patterns.map((pattern) => ({
      agentId,
      role,
      stageName: pattern.stageName,
      filePattern: pattern.filePatternFn(context.featureSlug, context.taskId),
      startedAt: new Date(),
      featureSlug: context.featureSlug,
      taskId: context.taskId,
    }));

    this.pendingWork.set(agentId, expectedOutputs);

    logger.info(
      {
        agentId,
        role,
        featureSlug: context.featureSlug,
        taskId: context.taskId,
        expectedStages: expectedOutputs.map((o) => o.stageName),
      },
      'Registered agent work'
    );
  }

  /**
   * Check if a newly created file matches any pending work.
   * If it does, this signals the agent's completion.
   *
   * @param artifactPath - Full path to the created artifact
   * @param stageName - The stage where the artifact was created
   * @returns CompletionEvent if the file signals an agent's completion, null otherwise
   */
  checkFileCreated(artifactPath: string, stageName: StageName): CompletionEvent | null {
    const filename = extractFilename(artifactPath);

    logger.debug(
      { artifactPath, stageName, filename, pendingAgents: Array.from(this.pendingWork.keys()) },
      'Checking if file creation signals agent completion'
    );

    // Check each pending work item
    for (const [agentId, expectedOutputs] of this.pendingWork) {
      for (const expected of expectedOutputs) {
        // Check if stage and filename pattern match
        if (expected.stageName === stageName && expected.filePattern.test(filename)) {
          logger.info(
            {
              agentId,
              role: expected.role,
              artifactPath,
              stageName,
              pattern: expected.filePattern.source,
            },
            'Agent completion detected via file creation'
          );

          // Remove from pending work
          this.pendingWork.delete(agentId);

          return {
            agentId,
            role: expected.role,
            artifactPath,
            stageName,
            completedAt: new Date(),
          };
        }
      }
    }

    return null;
  }

  /**
   * Cancel tracking for an agent (e.g., if the agent errored or was stopped)
   *
   * @param agentId - The agent to stop tracking
   */
  cancelWork(agentId: AgentId): void {
    if (this.pendingWork.has(agentId)) {
      logger.info({ agentId }, 'Cancelled agent work tracking');
      this.pendingWork.delete(agentId);
    }
  }

  /**
   * Get the list of agents currently being tracked
   */
  getPendingAgents(): AgentId[] {
    return Array.from(this.pendingWork.keys());
  }

  /**
   * Check if a specific agent is being tracked
   */
  isTracking(agentId: AgentId): boolean {
    return this.pendingWork.has(agentId);
  }

  /**
   * Get expected outputs for an agent
   */
  getExpectedOutputs(agentId: AgentId): ExpectedOutput[] | undefined {
    return this.pendingWork.get(agentId);
  }

  /**
   * Clear all pending work (e.g., on shutdown)
   */
  clear(): void {
    logger.info({ count: this.pendingWork.size }, 'Clearing all pending work');
    this.pendingWork.clear();
  }
}
