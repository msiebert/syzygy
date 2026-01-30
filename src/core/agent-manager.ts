/**
 * Unified Agent Manager
 *
 * Handles all agent lifecycle management consistently across all agent types.
 * Creates tmux panes in the current window and manages Claude Code instances.
 * Using panes instead of windows allows multiple agents to be visible simultaneously.
 */

import { unlink } from 'node:fs/promises';
import type { AgentRole, AgentId } from '../types/agent.types.js';
import { toAgentId } from '../types/agent.types.js';
import { createModuleLogger } from '@utils/logger';
import { escapeShellArg } from '@utils/sanitize';
import {
  type PaneId,
  splitPaneWithCommand,
  capturePaneById,
  closePane,
  sendKeysRawToPane,
  sendSpecialKeyToPane,
} from '@utils/tmux-utils';

// Re-export PaneId for consumers of this module
export type { PaneId } from '@utils/tmux-utils';

const logger = createModuleLogger('agent-manager');

/**
 * Status of an agent in its lifecycle
 */
export type AgentStatus =
  | 'starting'      // Pane created, waiting for Claude Code
  | 'ready'         // Claude Code running, initial prompt sent
  | 'working'       // Processing task
  | 'stuck'         // No activity for too long
  | 'completed'     // Finished work
  | 'error'         // Failed to start or crashed
  | 'stopped';      // Manually stopped

/**
 * Configuration for starting an agent
 */
export interface AgentStartConfig {
  /** Agent role */
  role: AgentRole;
  /** Workflow name for window naming */
  workflowName: string;
  /** System prompt + initial task to send after Claude is ready */
  initialPrompt: string;
  /** Working directory for Claude */
  workingDirectory: string;
  /** Optional session ID for Claude (defaults to UUID) */
  sessionId?: string;
  /** If true, focus window after creation (default: true) */
  autoFocus?: boolean;
}

/**
 * Handle returned when an agent is started
 */
export interface AgentHandle {
  /** Unique agent ID */
  id: AgentId;
  /** Tmux pane ID where agent is running */
  paneId: PaneId;
  /** Agent role */
  role: AgentRole;
  /** When the agent was started */
  startedAt: Date;
  /** Promise that resolves when Claude is ready */
  waitForReady: () => Promise<void>;
}

/**
 * Information about a running agent
 */
export interface AgentInfo {
  id: AgentId;
  paneId: PaneId;
  role: AgentRole;
  status: AgentStatus;
  lastActivity: Date;
  currentTask: string | undefined;
}

/**
 * Retry configuration for agent startup
 */
export interface RetryConfig {
  /** Maximum number of attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in ms (default: 10000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
}

/**
 * Lifecycle configuration
 */
export interface AgentLifecycleConfig {
  /** Timeout for Claude to become ready in ms (default: 30000) */
  readyTimeoutMs: number;
  /** Number of retry attempts (default: 3) */
  retryAttempts: number;
  /** Initial retry delay in ms (default: 1000) */
  retryDelayMs: number;
  /** Timeout for stuck detection in ms (default: 600000 = 10 min) */
  stuckTimeoutMs: number;
  /** Whether to keep completed panes (default: true) */
  keepCompletedPanes: boolean;
  /** Whether to cleanup on exit (default: true) */
  cleanupOnExit: boolean;
}

const defaultConfig: AgentLifecycleConfig = {
  readyTimeoutMs: 30000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  stuckTimeoutMs: 600000,
  keepCompletedPanes: true,
  cleanupOnExit: true,
};

const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Internal state for a managed agent
 */
interface ManagedAgent {
  id: AgentId;
  paneId: PaneId;
  role: AgentRole;
  status: AgentStatus;
  startedAt: Date;
  lastActivity: Date;
  currentTask: string | undefined;
  abortController?: AbortController;
}

/**
 * Error thrown when agent startup fails
 */
export class AgentStartError extends Error {
  public readonly config: AgentStartConfig;
  public readonly originalCause: Error | undefined;

  constructor(
    message: string,
    config: AgentStartConfig,
    originalCause?: Error
  ) {
    super(message);
    this.name = 'AgentStartError';
    this.config = config;
    this.originalCause = originalCause;
  }
}

/**
 * Execute a tmux command and return stdout
 */
async function execTmux(args: string[]): Promise<string> {
  const proc = Bun.spawn(['tmux', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`tmux ${args[0]} failed: ${errorOutput.trim() || 'unknown error'}`);
  }

  return output.trim();
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if Claude Code is ready based on pane content
 */
function isClaudeReady(output: string): boolean {
  // Look for the '>' prompt character that indicates Claude is ready for input
  // Also check for other known ready indicators
  return (
    output.includes('Claude Code') ||
    output.includes('How can I help') ||
    output.includes('What would you like to work on?') ||
    /^>\s*$/m.test(output) ||
    output.includes('claude>')
  );
}

/**
 * Unified Agent Manager
 *
 * Manages Claude Code agent instances running in tmux windows.
 * All agents are created as panes in the current tmux window.
 */
export class AgentManager {
  private agents: Map<AgentId, ManagedAgent> = new Map();
  private config: AgentLifecycleConfig;
  private cleanupRegistered = false;

  constructor(config: Partial<AgentLifecycleConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Start an agent with automatic retry
   */
  async startAgent(config: AgentStartConfig): Promise<AgentHandle> {
    return this.startWithRetry(config, defaultRetryConfig);
  }

  /**
   * Start an agent with custom retry configuration
   */
  async startWithRetry(
    config: AgentStartConfig,
    retry: RetryConfig = defaultRetryConfig
  ): Promise<AgentHandle> {
    let lastError: Error | undefined;
    let delay = retry.initialDelayMs;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        logger.info({ role: config.role, attempt }, 'Starting agent');
        return await this.doStartAgent(config);
      } catch (err) {
        lastError = err as Error;
        logger.warn(
          { role: config.role, attempt, error: lastError.message },
          'Agent start attempt failed'
        );

        if (attempt < retry.maxAttempts) {
          await sleep(delay);
          delay = Math.min(delay * retry.backoffMultiplier, retry.maxDelayMs);
        }
      }
    }

    throw new AgentStartError(
      `Failed to start ${config.role} after ${retry.maxAttempts} attempts`,
      config,
      lastError
    );
  }

  /**
   * Internal: Actually start an agent (single attempt)
   */
  private async doStartAgent(config: AgentStartConfig): Promise<AgentHandle> {
    const agentId = toAgentId(config.role);
    const sessionId = config.sessionId ?? crypto.randomUUID();

    // Register cleanup handlers on first agent
    if (!this.cleanupRegistered && this.config.cleanupOnExit) {
      this.registerCleanupHandlers();
    }

    // Create a new tmux pane (horizontal split for side-by-side layout)
    logger.info({ role: config.role }, 'Creating tmux pane');
    const paneId = await splitPaneWithCommand('horizontal', 'bash', 50);

    // Auto-focus the pane if requested (default: true)
    const shouldFocus = config.autoFocus !== false;
    if (shouldFocus) {
      await execTmux(['select-pane', '-t', paneId]);
    }

    // Track the agent
    const abortController = new AbortController();
    const agent: ManagedAgent = {
      id: agentId,
      paneId,
      role: config.role,
      status: 'starting',
      startedAt: new Date(),
      lastActivity: new Date(),
      currentTask: undefined,
      abortController,
    };
    this.agents.set(agentId, agent);

    // Write initial prompt to temp file (avoids tmux send-keys corruption for long prompts)
    let tempPromptPath: string | undefined;
    if (config.initialPrompt) {
      tempPromptPath = `/tmp/syzygy-prompt-${agentId}-${Date.now()}.txt`;
      await Bun.write(tempPromptPath, config.initialPrompt);
      logger.debug({ tempPromptPath }, 'Wrote initial prompt to temp file');
    }

    try {
      // Give shell time to initialize
      await sleep(300);

      // Change to working directory
      await this.sendToPane(paneId, `cd ${escapeShellArg(config.workingDirectory)}`);
      await sleep(300);

      // Start Claude Code with initial prompt from file (avoids tmux corruption)
      // Use $(cat file) to read prompt - bypasses tmux for long string content
      let claudeCommand = `claude --session-id ${escapeShellArg(sessionId)}`;
      if (tempPromptPath) {
        claudeCommand += ` "$(cat ${escapeShellArg(tempPromptPath)})"`;
      }
      logger.info({ paneId, claudeCommand: claudeCommand.slice(0, 200) + '...' }, 'Starting Claude Code');
      await this.sendToPane(paneId, claudeCommand);

      // Create promise for readiness
      const readyPromise = this.waitForReady(paneId, abortController.signal);

      // Return handle immediately - caller can await readyPromise
      const handle: AgentHandle = {
        id: agentId,
        paneId,
        role: config.role,
        startedAt: agent.startedAt,
        waitForReady: async () => {
          await readyPromise;

          // Clean up temp prompt file if used
          if (tempPromptPath) {
            try {
              const exists = await Bun.file(tempPromptPath).exists();
              if (exists) {
                await unlink(tempPromptPath);
              }
              logger.debug({ tempPromptPath }, 'Cleaned up temp prompt file');
            } catch {
              // Ignore cleanup errors
            }
          }

          logger.info({ agentId, paneId }, 'Claude ready with initial prompt');
          agent.status = 'ready';
          agent.lastActivity = new Date();
        },
      };

      return handle;
    } catch (error) {
      // Cleanup on failure
      agent.status = 'error';
      await closePane(paneId).catch(() => {});
      this.agents.delete(agentId);

      // Clean up temp prompt file if created
      if (tempPromptPath) {
        await unlink(tempPromptPath).catch(() => {});
      }

      throw error;
    }
  }

  /**
   * Wait for Claude to be ready in a pane
   */
  private async waitForReady(paneId: PaneId, signal: AbortSignal): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < this.config.readyTimeoutMs) {
      if (signal.aborted) {
        throw new Error('Agent startup aborted');
      }

      try {
        const content = await capturePaneById(paneId);
        if (isClaudeReady(content)) {
          logger.info({ paneId }, 'Claude is ready, waiting for settling delay');
          // Settling delay: allow Claude to fully initialize before sending prompts
          await sleep(500);
          logger.info({ paneId }, 'Settling delay complete, Claude ready for prompts');
          return;
        }
      } catch {
        // Ignore capture errors during polling
      }

      await sleep(pollInterval);
    }

    throw new Error(`Claude failed to become ready within ${this.config.readyTimeoutMs}ms`);
  }

  /**
   * Send a command to a pane (adds Enter key)
   */
  private async sendToPane(paneId: PaneId, command: string): Promise<void> {
    await sendKeysRawToPane(paneId, command);
    await sendSpecialKeyToPane(paneId, 'Enter');
  }

  /**
   * Send a prompt to a pane (handles escaping and multi-line)
   */
  private async sendPromptToPane(paneId: PaneId, prompt: string): Promise<void> {
    // For long prompts, split into chunks to avoid shell line limits
    const maxChunkSize = 4000;

    logger.debug({ paneId, promptLength: prompt.length }, 'Sending prompt to pane');

    if (prompt.length <= maxChunkSize) {
      // Short prompt - send directly
      await sendKeysRawToPane(paneId, prompt);
      logger.debug({ paneId }, 'Prompt text sent, sending Enter key');
      await sendSpecialKeyToPane(paneId, 'Enter');
    } else {
      // Long prompt - send in chunks
      for (let i = 0; i < prompt.length; i += maxChunkSize) {
        const chunk = prompt.slice(i, i + maxChunkSize);
        await sendKeysRawToPane(paneId, chunk);
        await sleep(50); // Small delay between chunks
      }
      logger.debug({ paneId }, 'All chunks sent, sending Enter key');
      await sendSpecialKeyToPane(paneId, 'Enter');
    }

    // Brief delay to ensure Claude receives the prompt before any subsequent operations
    await sleep(100);
    logger.debug({ paneId }, 'Prompt delivery complete');
  }

  /**
   * Close a tmux pane
   */
  private async killPane(paneId: PaneId): Promise<void> {
    try {
      await closePane(paneId);
    } catch {
      // Ignore errors if pane doesn't exist
    }
  }

  /**
   * Send a message to a running agent
   */
  async sendMessage(agentId: AgentId, message: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status !== 'ready' && agent.status !== 'working') {
      throw new Error(`Agent ${agentId} is not ready (status: ${agent.status})`);
    }

    await this.sendPromptToPane(agent.paneId, message);
    agent.status = 'working';
    agent.lastActivity = new Date();
  }

  /**
   * Get current status of an agent
   */
  getStatus(agentId: AgentId): AgentStatus | undefined {
    return this.agents.get(agentId)?.status;
  }

  /**
   * List all active agents
   */
  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).map(agent => ({
      id: agent.id,
      paneId: agent.paneId,
      role: agent.role,
      status: agent.status,
      lastActivity: agent.lastActivity,
      currentTask: agent.currentTask,
    }));
  }

  /**
   * Stop a specific agent
   */
  async stopAgent(agentId: AgentId): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    logger.info({ agentId }, 'Stopping agent');

    // Abort any pending operations
    agent.abortController?.abort();

    // Kill the pane
    await this.killPane(agent.paneId);

    // Remove from tracking
    agent.status = 'stopped';
    this.agents.delete(agentId);
  }

  /**
   * Stop all agents (cleanup)
   */
  async stopAll(): Promise<void> {
    logger.info({ count: this.agents.size }, 'Stopping all agents');

    const agentIds = Array.from(this.agents.keys());
    await Promise.all(agentIds.map(id => this.stopAgent(id)));
  }

  /**
   * Focus (switch to) an agent's pane
   */
  async focusAgent(agentId: AgentId): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn({ agentId }, 'Cannot focus agent - not found');
      return;
    }

    try {
      await execTmux(['select-pane', '-t', agent.paneId]);
      logger.debug({ agentId, paneId: agent.paneId }, 'Focused agent pane');
    } catch (error) {
      logger.warn({ agentId, error }, 'Failed to focus agent pane');
    }
  }

  /**
   * Get agent info by ID
   */
  getAgent(agentId: AgentId): AgentInfo | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }
    return {
      id: agent.id,
      paneId: agent.paneId,
      role: agent.role,
      status: agent.status,
      lastActivity: agent.lastActivity,
      currentTask: agent.currentTask,
    };
  }

  /**
   * Mark an agent as completed
   */
  markCompleted(agentId: AgentId): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'completed';
      agent.lastActivity = new Date();

      if (!this.config.keepCompletedPanes) {
        void this.stopAgent(agentId);
      }
    }
  }

  /**
   * Update the current task for an agent
   */
  setCurrentTask(agentId: AgentId, taskPath: string | undefined): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.currentTask = taskPath;
      agent.lastActivity = new Date();
    }
  }

  /**
   * Check for stuck agents and return their IDs
   */
  checkForStuckAgents(): AgentId[] {
    const now = Date.now();
    const stuck: AgentId[] = [];

    for (const agent of this.agents.values()) {
      if (agent.status === 'working') {
        const idleTime = now - agent.lastActivity.getTime();
        if (idleTime > this.config.stuckTimeoutMs) {
          agent.status = 'stuck';
          stuck.push(agent.id);
        }
      }
    }

    return stuck;
  }

  /**
   * Register cleanup handlers for process exit
   */
  private registerCleanupHandlers(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => {
      // Synchronous cleanup - best effort
      for (const agent of this.agents.values()) {
        try {
          Bun.spawnSync(['tmux', 'kill-pane', '-t', agent.paneId]);
        } catch {
          // Ignore errors during cleanup
        }
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(143);
    });
    process.on('uncaughtException', (err) => {
      logger.error({ error: err }, 'Uncaught exception, cleaning up');
      cleanup();
      process.exit(1);
    });
  }
}

// Export singleton instance for convenience
export const agentManager: AgentManager = new AgentManager();
