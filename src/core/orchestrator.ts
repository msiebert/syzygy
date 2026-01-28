/**
 * Main orchestration engine
 * Coordinates all agents through the workflow
 */

import type { WorkflowState, WorkflowEvent } from '../types/workflow.types.js';
import type { Agent, AgentRole } from '../types/agent.types.js';
import { toAgentId } from '../types/agent.types.js';
import { SessionManager } from './session-manager.js';
import { WorkflowEngine } from './workflow-engine.js';
import { FileMonitor } from './file-monitor.js';
import { AgentRunner } from './agent-runner.js';
import { StageManager } from '../stages/stage-manager.js';
import { PMMonitor } from './pm-monitor.js';
import { SplitScreenController } from '../cli/split-screen.js';
import {
  getAlwaysRunningAgents,
  getSessionName,
} from '../agents/agent-config.js';
import {
  generateInstructions,
  type InstructionContext,
} from '../agents/agent-instructions.js';
import { createModuleLogger } from '@utils/logger';
import {
  sendKeysRaw,
  sendSpecialKey,
  sendKeysRawToPane,
  sendSpecialKeyToPane,
  killSessions,
  isInsideTmux,
  launchClaudeCLIInPane,
  closePane,
  ensureClaudeRunning,
  type PaneId,
} from '../utils/tmux-utils.js';
import { openPMInPane } from '../utils/terminal-window.js';
import path from 'path';

const logger = createModuleLogger('orchestrator');

export interface OrchestratorConfig {
  numDevelopers?: number;      // Number of parallel developers (default: 1)
  workspaceRoot?: string;       // Root directory (default: process.cwd())
  pollInterval?: number;        // Agent polling interval in ms (default: 2000)
}

/**
 * Main orchestration engine that coordinates all agents
 */
export class Orchestrator {
  private config: Required<OrchestratorConfig>;
  private sessionManager: SessionManager;
  private workflowEngine: WorkflowEngine | undefined;
  private fileMonitor: FileMonitor;
  private agentRunner: AgentRunner;
  private stageManager: StageManager;
  private agents: Map<string, Agent> = new Map();
  private isRunning = false;
  private pmMonitor?: PMMonitor;
  private splitScreen?: SplitScreenController;
  private pmTimeout: NodeJS.Timeout | undefined;
  private pmInitResult: { waitForReady: () => Promise<void>; abort: () => void } | undefined = undefined;
  private pmPaneId: PaneId | null = null;

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      numDevelopers: config.numDevelopers ?? 1,
      workspaceRoot: config.workspaceRoot ?? process.cwd(),
      pollInterval: config.pollInterval ?? 2000,
    };

    // Initialize core components
    this.sessionManager = new SessionManager();
    this.fileMonitor = new FileMonitor({ debounceMs: 100 });
    this.agentRunner = new AgentRunner();
    this.stageManager = new StageManager();

    logger.info({ config: this.config }, 'Orchestrator initialized');
  }

  /**
   * Start a new workflow
   * Returns quickly - Claude initialization happens in background
   */
  async startWorkflow(featureName: string, initialPrompt: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Workflow is already running');
    }

    logger.info({ featureName, initialPrompt }, 'Starting workflow');

    try {
      // Clean up any orphaned sessions from previous runs
      await killSessions('syzygy-.*');

      // Initialize workflow engine
      this.workflowEngine = new WorkflowEngine(featureName, initialPrompt);

      // Initialize workspace (create stage directories)
      const workspaceRoot = path.join(this.config.workspaceRoot, '.syzygy');
      await this.stageManager.initializeStages(workspaceRoot);
      logger.info('Workspace initialized');

      // Create split screen UI immediately - shows initialization progress
      this.splitScreen = new SplitScreenController(featureName);

      // Setup file monitoring
      this.setupFileMonitoring();

      // Create core agents with async Claude initialization
      await this.createCoreAgentsAsync();
      logger.info('Core agents created (Claude init in background)');

      // Update initial agent statuses in UI
      this.splitScreen.updateAgents(Array.from(this.agents.values()));
      this.splitScreen.updateWorkflowState('spec_pending');

      // Transition to spec_pending state
      this.workflowEngine.transitionTo('spec_pending');

      // Start file monitoring
      this.fileMonitor.start();

      this.isRunning = true;

      logger.info({ featureName }, 'Workflow started successfully');
    } catch (error) {
      logger.error({ featureName, error }, 'Failed to start workflow');
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Start the UI display
   * Call this after startWorkflow to begin rendering
   */
  startUI(): void {
    if (!this.splitScreen) {
      throw new Error('Workflow not started - call startWorkflow first');
    }

    // Clear terminal for clean Ink rendering
    console.clear();

    // Start split screen display - shows initialization progress until PM is ready
    this.splitScreen.start();
  }

  /**
   * Stop the workflow and cleanup
   */
  async stopWorkflow(): Promise<void> {
    logger.info('Stopping workflow');

    try {
      await this.cleanup();
      this.isRunning = false;
      logger.info('Workflow stopped successfully');
    } catch (error) {
      logger.error({ error }, 'Error during workflow cleanup');
      throw error;
    }
  }

  /**
   * Get current workflow state
   */
  getWorkflowState(): WorkflowState {
    if (!this.workflowEngine) {
      return 'idle';
    }
    return this.workflowEngine.getCurrentState();
  }

  /**
   * Get all active agents
   */
  getActiveAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get specific agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Setup file monitoring for stage directories
   * @private
   */
  private setupFileMonitoring(): void {
    const stagesDir = path.join(this.config.workspaceRoot, '.syzygy', 'stages');

    // Watch all pending directories
    const stageNames = ['spec', 'arch', 'tasks', 'tests', 'impl', 'review', 'docs'];
    for (const stageName of stageNames) {
      const pendingDir = path.join(stagesDir, stageName, 'pending');
      this.fileMonitor.addWatchPath(pendingDir);
    }

    // Listen for artifact events
    this.fileMonitor.on('artifact:created', (event) => {
      void this.handleArtifactCreated(event);
    });

    logger.info('File monitoring configured');
  }

  /**
   * Create core agents (PM and Architect) that are always running
   * @private
   * @deprecated Use createCoreAgentsAsync for non-blocking initialization
   */
  // @ts-expect-error - Preserved for backwards compatibility, use createCoreAgentsAsync instead
  private async createCoreAgents(): Promise<void> {
    const coreConfigs = getAlwaysRunningAgents();

    for (const config of coreConfigs) {
      const agent: Agent = {
        id: toAgentId(config.role),
        role: config.role,
        sessionName: getSessionName(config.role),
        status: 'idle',
      };

      // Generate system prompt for the agent
      if (!this.workflowEngine) {
        throw new Error('Workflow engine not initialized');
      }

      const context: InstructionContext = {
        featureName: this.workflowEngine.getFeatureName(),
        featureSlug: this.workflowEngine.getFeatureSlug(),
        initialPrompt: this.workflowEngine.getInitialPrompt(),
      };

      const systemPrompt = generateInstructions(config.role, context);

      // Create tmux session and launch Claude CLI for PM only
      await this.sessionManager.createAgentSession(agent, {
        launchClaude: config.role === 'product-manager',
        systemPrompt,
        workingDirectory: this.config.workspaceRoot,
        sessionId: crypto.randomUUID(),
      });

      // Store agent
      this.agents.set(agent.id, agent);

      logger.info({ agentId: agent.id, role: agent.role }, 'Core agent created');
    }
  }

  /**
   * Create core agents with async Claude CLI initialization
   * Returns quickly - Claude init runs in background
   * @private
   */
  private async createCoreAgentsAsync(): Promise<void> {
    const coreConfigs = getAlwaysRunningAgents();

    for (const config of coreConfigs) {
      const agent: Agent = {
        id: toAgentId(config.role),
        role: config.role,
        sessionName: getSessionName(config.role),
        status: 'idle',
      };

      // Generate system prompt for the agent
      if (!this.workflowEngine) {
        throw new Error('Workflow engine not initialized');
      }

      const context: InstructionContext = {
        featureName: this.workflowEngine.getFeatureName(),
        featureSlug: this.workflowEngine.getFeatureSlug(),
        initialPrompt: this.workflowEngine.getInitialPrompt(),
      };

      const systemPrompt = generateInstructions(config.role, context);

      // Show initialization progress for PM
      if (config.role === 'product-manager') {
        this.splitScreen?.updateInitProgress(agent.id, 'initializing', 0);

        if (isInsideTmux()) {
          // Inside tmux: Create pane first, then run Claude directly in it.
          // This avoids the "size missing" issue with detached sessions.
          logger.info('Running inside tmux - using pane-based PM launch');

          const result = await launchClaudeCLIInPane({
            systemPrompt,
            workingDirectory: this.config.workspaceRoot,
            sessionId: crypto.randomUUID(),
            direction: 'horizontal',
            percentage: 50,
          }, {
            onProgress: (elapsed) => {
              this.splitScreen?.updateInitProgress(agent.id, 'initializing', elapsed);
            },
            onReady: () => {
              this.splitScreen?.updateInitProgress(agent.id, 'ready', 0);
              this.onPMReady();
            },
            onError: () => {
              this.splitScreen?.updateInitProgress(agent.id, 'error', 0);
            },
          });

          // Store the pane ID for cleanup and the init result for abort
          this.pmPaneId = result.paneId;
          this.pmInitResult = { waitForReady: result.waitForReady, abort: result.abort };

          // PM is already visible in the split pane - no need for openPMTerminalWindow
          logger.info({ paneId: result.paneId }, 'PM launched in split pane');
        } else {
          // Not inside tmux: Use the session-based approach with manual attach instructions
          logger.info('Not running inside tmux - using session-based PM launch');

          const result = await this.sessionManager.createAgentSessionAsync(agent, {
            launchClaude: true,
            systemPrompt,
            workingDirectory: this.config.workspaceRoot,
            sessionId: crypto.randomUUID(),
          }, {
            onProgress: (agentId, elapsed) => {
              this.splitScreen?.updateInitProgress(agentId, 'initializing', elapsed);
            },
            onReady: (agentId) => {
              this.splitScreen?.updateInitProgress(agentId, 'ready', 0);
              this.onPMReady();
            },
            onError: (agentId) => {
              this.splitScreen?.updateInitProgress(agentId, 'error', 0);
            },
          });

          // Store the init result so we can abort if needed
          this.pmInitResult = result.claudeInit;
        }
      } else {
        // Non-PM agents: just create tmux session (no Claude CLI)
        await this.sessionManager.createAgentSession(agent, {
          launchClaude: false,
          systemPrompt,
          workingDirectory: this.config.workspaceRoot,
          sessionId: crypto.randomUUID(),
        });
      }

      // Store agent
      this.agents.set(agent.id, agent);

      logger.info({ agentId: agent.id, role: agent.role }, 'Core agent created');
    }
  }

  /**
   * Called when PM Claude CLI is ready
   * @private
   */
  private onPMReady(): void {
    // Hide initialization panel
    this.splitScreen?.setInitializationComplete();

    // Get PM agent
    const pmAgent = this.agents.get('product-manager');
    if (!this.workflowEngine) return;

    // Create PM monitor (simplified - just watches for spec file)
    // Note: When using pane-based approach, pmAgent may not have a session,
    // but we still need to monitor for the spec file
    if (pmAgent) {
      this.pmMonitor = new PMMonitor(pmAgent.sessionName, {
        pollInterval: 1000, // 1s polling for spec file detection
        featureName: this.workflowEngine.getFeatureName(),
        featureSlug: this.workflowEngine.getFeatureSlug(),
        onSpecComplete: () => {
          void this.handleSpecComplete();
        },
      });

      // Start PM monitoring
      this.pmMonitor.startPolling().catch(() => {
        // Ignore polling start errors
      });
    }

    // Set 30-minute timeout for PM interaction
    this.pmTimeout = setTimeout(() => {
      void this.handlePMTimeout();
    }, 30 * 60 * 1000);

    // Send initial prompt to PM to kick off the conversation
    void this.sendInitialPromptToPM();

    // If we're inside tmux, the PM pane is already open (via launchClaudeCLIInPane).
    // Only try to open a separate window if we're NOT inside tmux.
    if (!isInsideTmux() && pmAgent) {
      void this.openPMTerminalWindow(pmAgent.sessionName);
    } else if (this.pmPaneId) {
      // PM pane is already open - just update the UI
      this.splitScreen?.setPMTerminalOpened();
      logger.info({ paneId: this.pmPaneId }, 'PM pane already open');
    }
  }

  /**
   * Open PM session in a tmux pane (same terminal)
   * @private
   */
  private async openPMTerminalWindow(sessionName: string): Promise<void> {
    try {
      const result = await openPMInPane(sessionName as import('../types/agent.types.js').SessionName);

      if (result.opened && result.paneId) {
        this.pmPaneId = result.paneId;
        this.splitScreen?.setPMTerminalOpened();
        logger.info({ sessionName, paneId: result.paneId }, 'PM pane opened');
      } else {
        // Failed to open PM pane - show instructions for manual attach
        logger.warn({ sessionName }, 'Failed to open PM pane, manual attach required');
        this.splitScreen?.showManualAttachInstructions(result.manualAttachCommand ?? `tmux attach -t ${sessionName}`);
      }
    } catch (error) {
      logger.error({ error, sessionName }, 'Failed to open PM pane');
      // Don't throw - the user can still manually attach to the tmux session
    }
  }

  /**
   * Send initial user prompt to PM to start the conversation
   * @private
   */
  private async sendInitialPromptToPM(): Promise<void> {
    if (!this.workflowEngine) return;

    const initialPrompt = this.workflowEngine.getInitialPrompt();
    if (!initialPrompt) {
      logger.warn('No initial prompt to send to PM');
      return;
    }

    try {
      logger.info({ initialPrompt }, 'Sending initial prompt to PM');

      // If we have a pane ID (pane-based approach), send to pane.
      // Otherwise, use the session-based approach.
      if (this.pmPaneId) {
        await sendKeysRawToPane(this.pmPaneId, initialPrompt);
        await sendSpecialKeyToPane(this.pmPaneId, 'Enter');
        logger.info({ paneId: this.pmPaneId }, 'Initial prompt sent to PM pane successfully');
      } else {
        const pmAgent = this.agents.get('product-manager');
        if (!pmAgent) {
          logger.warn('No PM agent found');
          return;
        }
        await sendKeysRaw(pmAgent.sessionName, initialPrompt);
        await sendSpecialKey(pmAgent.sessionName, 'Enter');
        logger.info('Initial prompt sent to PM session successfully');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send initial prompt to PM');
    }
  }

  /**
   * Handle artifact created event
   * @private
   */
  private async handleArtifactCreated(event: WorkflowEvent): Promise<void> {
    logger.info({ event }, 'Handling artifact created');

    try {
      const payload = event.payload as { artifactPath: string; stageName: string };
      const { artifactPath, stageName } = payload;

      // Determine next agent based on stage
      const nextAgentInfo = this.determineNextAgent(stageName);

      if (!nextAgentInfo) {
        logger.warn({ stageName }, 'No next agent for stage');
        return;
      }

      // Create agent if needed (for on-demand agents like developers)
      const agent = await this.createAgentIfNeeded(
        nextAgentInfo.role,
        nextAgentInfo.instance
      );

      // Prepare instruction context
      if (!this.workflowEngine) {
        throw new Error('Workflow engine not initialized');
      }

      // Build context with only relevant paths
      const context: InstructionContext = {
        featureName: this.workflowEngine.getFeatureName(),
        featureSlug: this.workflowEngine.getFeatureSlug(),
      };

      // Add stage-specific path
      switch (stageName) {
        case 'spec':
          context.specPath = artifactPath;
          break;
        case 'arch':
          context.archPath = artifactPath;
          break;
        case 'tasks':
          context.taskPath = artifactPath;
          break;
        case 'tests':
          context.testPath = artifactPath;
          break;
        case 'impl':
          context.implPath = artifactPath;
          break;
      }

      // Send instruction to agent
      await this.sendInstructionToAgent(agent.id, context);

      // Transition workflow state
      const nextState = this.getNextWorkflowState(stageName);
      if (nextState) {
        this.workflowEngine.transitionTo(nextState);
      }

      logger.info(
        { agentId: agent.id, nextState, stageName },
        'Artifact handled successfully'
      );
    } catch (error) {
      logger.error({ error, event }, 'Failed to handle artifact');
      this.handleAgentError('orchestrator', error as Error);
    }
  }

  /**
   * Determine which agent should process an artifact from a given stage
   * @private
   */
  private determineNextAgent(
    stageName: string
  ): { role: AgentRole; instance?: number } | null {
    switch (stageName) {
      case 'spec':
        return { role: 'architect' };
      case 'arch':
        return { role: 'test-engineer' };
      case 'tasks':
      case 'tests':
        return { role: 'developer', instance: 1 }; // TODO: Load balance across multiple developers
      case 'impl':
        return { role: 'code-reviewer' };
      case 'review':
        return { role: 'documenter' };
      case 'docs':
        return null; // Documentation is the final stage
      default:
        logger.warn({ stageName }, 'Unknown stage name');
        return null;
    }
  }

  /**
   * Get the next workflow state based on the current stage
   * @private
   */
  private getNextWorkflowState(stageName: string): WorkflowState | null {
    switch (stageName) {
      case 'spec':
        return 'arch_pending';
      case 'arch':
        return 'tests_pending';
      case 'tasks':
      case 'tests':
        return 'impl_pending';
      case 'impl':
        return 'review_pending';
      case 'review':
        return 'docs_pending';
      case 'docs':
        return 'complete';
      default:
        logger.warn({ stageName }, 'Unknown stage name for state transition');
        return null;
    }
  }

  /**
   * Create an on-demand agent if needed
   * @private
   */
  private async createAgentIfNeeded(
    role: AgentRole,
    instance?: number
  ): Promise<Agent> {
    const agentId = toAgentId(instance !== undefined ? `${role}-${instance}` : role);

    // Check if agent already exists
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent;
    }

    // Create new agent
    const newAgent: Agent = {
      id: agentId,
      role,
      sessionName: getSessionName(role, instance),
      status: 'idle',
    };

    await this.sessionManager.createAgentSession(newAgent);
    this.agents.set(agentId, newAgent);

    logger.info({ agentId, role }, 'On-demand agent created');

    return newAgent;
  }

  /**
   * Send instruction to an agent
   * Ensures Claude is running in the agent's session before sending
   * @private
   */
  private async sendInstructionToAgent(
    agentId: string,
    context: InstructionContext
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Generate the system prompt for this agent (used if Claude needs to be launched)
    const systemPrompt = generateInstructions(agent.role, context);

    // Ensure Claude is running in the session before sending instructions
    // This handles the lazy initialization of non-PM agents
    logger.info({ agentId, role: agent.role }, 'Ensuring Claude is running before sending instruction');
    await ensureClaudeRunning(agent.sessionName, {
      systemPrompt,
      workingDirectory: this.config.workspaceRoot,
      sessionId: `syzygy-${agent.role}-${crypto.randomUUID()}`,
      onProgress: (elapsed) => {
        if (elapsed % 15 === 0) {
          logger.info({ agentId, elapsed }, 'Waiting for Claude to initialize...');
        }
      },
      onReady: () => {
        logger.info({ agentId }, 'Claude ready in session');
      },
      onError: (error) => {
        logger.error({ agentId, error }, 'Failed to initialize Claude in session');
      },
    });

    // Now send the actual instruction (the task-specific context)
    const instruction = generateInstructions(agent.role, context);
    await this.agentRunner.sendInstruction(agent.sessionName, instruction);

    // Update agent status
    agent.status = 'working';
    if (context.taskPath !== undefined) {
      agent.currentTask = context.taskPath;
    }
    this.agents.set(agentId, agent);

    logger.info({ agentId, role: agent.role }, 'Instruction sent to agent');
  }

  /**
   * Monitor agent work progress
   * @private
   * @future Will be used to monitor agent completion with timeout
   */
  // @ts-expect-error - Reserved for future implementation
  private async monitorAgentWork(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    try {
      // Wait for completion with timeout
      const completed = await this.agentRunner.waitForCompletion(
        agent.sessionName,
        30 * 60 * 1000 // 30 minutes timeout
      );

      if (completed) {
        agent.status = 'complete';
        logger.info({ agentId }, 'Agent completed work');
      } else {
        agent.status = 'error';
        logger.warn({ agentId }, 'Agent timed out');
      }

      this.agents.set(agentId, agent);
    } catch (error) {
      logger.error({ agentId, error }, 'Error monitoring agent');
      agent.status = 'error';
      this.agents.set(agentId, agent);
    }
  }

  /**
   * Handle agent error
   * @private
   */
  private handleAgentError(agentId: string, error: Error): void {
    logger.error({ agentId, error }, 'Agent error occurred');

    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'error';
      this.agents.set(agentId, agent);
    }

    // Transition workflow to error state
    if (this.workflowEngine) {
      this.workflowEngine.transitionToError(
        error.message,
        agentId,
        this.workflowEngine.getCurrentState()
      );
    }
  }

  /**
   * Handle spec completion
   * @private
   */
  private async handleSpecComplete(): Promise<void> {
    logger.info('PM spec complete, transitioning workflow');

    // Clear PM timeout
    if (this.pmTimeout) {
      clearTimeout(this.pmTimeout);
      this.pmTimeout = undefined;
    }

    // Stop PM monitoring
    this.pmMonitor?.stopPolling();

    // Transition workflow to next stage
    this.workflowEngine?.transitionTo('arch_pending');

    // Update UI
    this.splitScreen?.updateWorkflowState('arch_pending');

    logger.info('Workflow transitioned to architecture stage');
  }

  /**
   * Handle PM timeout
   * @private
   */
  private async handlePMTimeout(): Promise<void> {
    logger.warn('PM session timed out');

    // Stop PM monitoring
    this.pmMonitor?.stopPolling();

    // For now, just log and continue
    // TODO: Add user prompt for action (continue/restart/abort)
    logger.warn('PM timeout handling not fully implemented - continuing');
  }

  /**
   * Cleanup resources (sessions, monitors)
   * @private
   */
  private async cleanup(): Promise<void> {
    logger.info('Cleaning up orchestrator resources');

    try {
      // Clear PM timeout
      if (this.pmTimeout) {
        clearTimeout(this.pmTimeout);
        this.pmTimeout = undefined;
      }

      // Abort PM initialization if still running
      if (this.pmInitResult) {
        this.pmInitResult.abort();
        this.pmInitResult = undefined;
      }

      // Stop PM monitoring
      this.pmMonitor?.stopPolling();

      // Close PM pane if it was opened
      if (this.pmPaneId) {
        try {
          await closePane(this.pmPaneId);
          logger.debug({ paneId: this.pmPaneId }, 'PM pane closed');
        } catch (error) {
          logger.warn({ error, paneId: this.pmPaneId }, 'Failed to close PM pane');
        }
        this.pmPaneId = null;
      }

      // Stop split screen
      this.splitScreen?.stop();

      // Stop file monitoring
      if (this.fileMonitor) {
        this.fileMonitor.stop();
        logger.debug('File monitor stopped');
      }

      // Cleanup all sessions
      await this.sessionManager.cleanupAllSessions();
      logger.debug('All sessions cleaned up');

      // Clear agents
      this.agents.clear();

      logger.info('Cleanup complete');
    } catch (error) {
      logger.error({ error }, 'Error during cleanup');
      throw error;
    }
  }
}
