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
import { sendKeysRaw, sendSpecialKey } from '../utils/tmux-utils.js';
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
   */
  async startWorkflow(featureName: string, initialPrompt: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Workflow is already running');
    }

    logger.info({ featureName, initialPrompt }, 'Starting workflow');

    try {
      // Initialize workflow engine
      this.workflowEngine = new WorkflowEngine(featureName, initialPrompt);

      // Initialize workspace (create stage directories)
      const workspaceRoot = path.join(this.config.workspaceRoot, '.syzygy');
      await this.stageManager.initializeStages(workspaceRoot);
      logger.info('Workspace initialized');

      // Setup file monitoring
      this.setupFileMonitoring();

      // Create always-running agents (PM and Architect)
      await this.createCoreAgents();
      logger.info('Core agents created');

      // Get PM agent
      const pmAgent = this.agents.get('product-manager');
      if (!pmAgent) {
        throw new Error('PM agent not found');
      }

      // Create split screen UI
      this.splitScreen = new SplitScreenController(featureName);
      this.splitScreen.start();
      logger.info('Split screen UI started');

      // Update initial agent statuses in UI
      this.splitScreen.updateAgents(Array.from(this.agents.values()));
      this.splitScreen.updateWorkflowState('spec_pending');

      // Create PM monitor
      this.pmMonitor = new PMMonitor(pmAgent.sessionName, {
        pollInterval: 200, // 200ms for low latency
        featureName,
        featureSlug: this.workflowEngine.getFeatureSlug(),
        onNewMessage: (message) => {
          this.splitScreen?.addChatMessage('pm', message);
        },
        onSpecComplete: () => {
          void this.handleSpecComplete();
        },
      });

      // Start PM monitoring
      await this.pmMonitor.startPolling();
      logger.info('PM monitoring started');

      // Enable interactive mode in split screen
      this.splitScreen.enableInteractiveMode(
        (char) => {
          void this.forwardInputToPM(char);
        },
        () => {
          void this.handlePMEarlyExit();
        }
      );
      logger.info('Interactive mode enabled');

      // Set 30-minute timeout for PM interaction
      this.pmTimeout = setTimeout(() => {
        void this.handlePMTimeout();
      }, 30 * 60 * 1000);

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
   */
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
        sessionId: `syzygy-${this.workflowEngine.getFeatureSlug()}-${config.role}`,
      });

      // Store agent
      this.agents.set(agent.id, agent);

      logger.info({ agentId: agent.id, role: agent.role }, 'Core agent created');
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
   * Forward user input to PM tmux session
   * @private
   */
  private async forwardInputToPM(char: string): Promise<void> {
    const pmAgent = this.agents.get('product-manager');
    if (!pmAgent) return;

    try {
      if (char === '\n') {
        await sendSpecialKey(pmAgent.sessionName, 'Enter');
      } else if (char === '\x7f') {
        await sendSpecialKey(pmAgent.sessionName, 'BSpace');
      } else {
        await sendKeysRaw(pmAgent.sessionName, char);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to forward input to PM');
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

    // Disable interactive mode
    this.splitScreen?.disableInteractiveMode();

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
    this.splitScreen?.disableInteractiveMode();

    // For now, just log and continue
    // TODO: Add user prompt for action (continue/restart/abort)
    logger.warn('PM timeout handling not fully implemented - continuing');
  }

  /**
   * Handle user exiting interactive mode early
   * @private
   */
  private async handlePMEarlyExit(): Promise<void> {
    logger.info('User exited PM interactive mode');

    // Check if spec exists
    if (!this.workflowEngine) return;

    const featureSlug = this.workflowEngine.getFeatureSlug();
    const specPath = `.syzygy/stages/spec/pending/${featureSlug}-spec.md`;

    try {
      const { access } = await import('node:fs/promises');
      await access(specPath);

      // Spec exists, continue workflow
      logger.info('Spec file exists, continuing workflow');
      await this.handleSpecComplete();
    } catch {
      // Spec doesn't exist, prompt user
      logger.warn('Spec incomplete, user exited early');
      // TODO: Add user prompt for action (reattach/abort)
      logger.warn('Early exit handling not fully implemented - aborting');
      await this.stopWorkflow();
    }
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

      // Stop PM monitoring
      this.pmMonitor?.stopPolling();

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
