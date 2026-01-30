/**
 * Main orchestration engine
 * Coordinates all agents through the workflow
 */

import type { WorkflowState, WorkflowEvent, ResumeResult } from '../types/workflow.types.js';
import type { Agent, AgentRole } from '../types/agent.types.js';
import { toAgentId } from '../types/agent.types.js';
import { SessionManager } from './session-manager.js';
import { WorkflowEngine } from './workflow-engine.js';
import { FileMonitor } from './file-monitor.js';
import { AgentRunner } from './agent-runner.js';
import { StageManager } from '../stages/stage-manager.js';
import { LockManager } from '../stages/lock-manager.js';
import { ResumeDetector } from './resume-detector.js';
import { PMMonitor } from './pm-monitor.js';
import { SplitScreenController } from '../cli/split-screen.js';
import { AgentManager } from './agent-manager.js';
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
  killSessions,
} from '../utils/tmux-utils.js';
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
  private lockManager: LockManager;
  private resumeDetector: ResumeDetector;
  private agentManager: AgentManager;
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
    this.lockManager = new LockManager();
    this.resumeDetector = new ResumeDetector(this.stageManager, this.lockManager);
    this.agentManager = new AgentManager({
      readyTimeoutMs: 60000, // 60s timeout for Claude to become ready
      cleanupOnExit: true,
    });

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
   * Resume a workflow from pending artifacts
   * Detects existing work and resumes from where it left off
   */
  async resumeWorkflow(): Promise<ResumeResult> {
    if (this.isRunning) {
      return {
        success: false,
        reason: 'no_pending_work',
        message: 'A workflow is already running',
      };
    }

    logger.info('Attempting to resume workflow');

    try {
      // Clean up any orphaned sessions from previous runs
      await killSessions('syzygy-.*');

      // Initialize workspace (create stage directories if needed)
      const workspaceRoot = path.join(this.config.workspaceRoot, '.syzygy');
      await this.stageManager.initializeStages(workspaceRoot);
      logger.info('Workspace initialized');

      // Detect resumable state
      const resumeState = await this.resumeDetector.detectResumableState(workspaceRoot);

      // Validate resume is possible
      if (!resumeState.hasPendingWork) {
        logger.info('No pending work to resume');
        return {
          success: false,
          reason: 'no_pending_work',
          message: 'No pending work found. Use "New Feature" to start a new workflow.',
        };
      }

      if (!resumeState.featureName) {
        logger.warn('Pending work found but could not determine feature name');
        return {
          success: false,
          reason: 'no_feature_name',
          message: 'Found pending work but could not determine feature name from artifacts.',
        };
      }

      // Create workflow engine in resumed state
      this.workflowEngine = WorkflowEngine.fromResumeState(
        resumeState.featureName,
        resumeState.featureSlug ?? resumeState.featureName,
        resumeState.resumeFromState
      );

      // Create split screen UI
      this.splitScreen = new SplitScreenController(resumeState.featureName);

      // Setup file monitoring
      this.setupFileMonitoring();

      // Create only required agents (skip PM since user interaction already happened)
      await this.createResumedAgents(resumeState.requiredAgents);
      logger.info({ agents: resumeState.requiredAgents }, 'Resumed agents created');

      // Update UI with agents and workflow state
      this.splitScreen.updateAgents(Array.from(this.agents.values()));
      this.splitScreen.updateWorkflowState(resumeState.resumeFromState);

      // Start file monitoring
      this.fileMonitor.start();

      // Trigger processing of existing pending artifacts
      await this.processPendingArtifacts(resumeState.pendingArtifacts);

      this.isRunning = true;

      logger.info(
        { featureName: resumeState.featureName, resumeFromState: resumeState.resumeFromState },
        'Workflow resumed successfully'
      );

      return {
        success: true,
        featureName: resumeState.featureName,
        resumeFromState: resumeState.resumeFromState,
        staleLocksCleanedUp: resumeState.staleLocksCleanedUp,
        message: `Resuming workflow for "${resumeState.featureName}" from ${resumeState.resumeFromState}`,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to resume workflow');
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Create agents required for resumed workflow
   * Unlike startWorkflow, this skips the PM agent
   * Agents are registered locally but not started - AgentManager starts them lazily
   * @private
   */
  private async createResumedAgents(requiredRoles: AgentRole[]): Promise<void> {
    for (const role of requiredRoles) {
      // Skip PM - user interaction already happened in original run
      if (role === 'product-manager') {
        continue;
      }

      const agentId = toAgentId(role);

      // Check if agent already exists
      if (this.agents.has(agentId)) {
        continue;
      }

      // Just register the agent locally - AgentManager will start it
      // when sendInstructionToAgent is called
      const agent: Agent = {
        id: agentId,
        role,
        sessionName: getSessionName(role),
        status: 'idle',
      };

      this.agents.set(agentId, agent);
      logger.info({ agentId, role }, 'Resumed agent registered (will start lazily)');
    }
  }

  /**
   * Process existing pending artifacts to trigger agent work
   * @private
   */
  private async processPendingArtifacts(
    pendingArtifacts: Map<import('../types/stage.types.js').StageName, string[]>
  ): Promise<void> {
    logger.info('Processing pending artifacts to trigger agent work');

    // Process artifacts in stage order (spec -> arch -> tasks/tests -> impl -> review -> docs)
    const stageOrder: import('../types/stage.types.js').StageName[] = [
      'spec', 'arch', 'tasks', 'tests', 'impl', 'review', 'docs'
    ];

    for (const stageName of stageOrder) {
      const artifacts = pendingArtifacts.get(stageName);
      if (!artifacts || artifacts.length === 0) {
        continue;
      }

      logger.info({ stageName, count: artifacts.length }, 'Found pending artifacts in stage');

      // Emit artifact:created events for each pending artifact
      // This will trigger the normal handleArtifactCreated flow
      for (const artifactPath of artifacts) {
        const event: WorkflowEvent = {
          type: 'artifact:created',
          timestamp: new Date(),
          payload: {
            artifactPath,
            stageName,
          },
        };

        // Handle the artifact (this will create agents and send instructions)
        await this.handleArtifactCreated(event);
      }
    }

    logger.info('Finished processing pending artifacts');
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
   * Uses AgentManager for unified agent lifecycle management
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

      // Only start PM immediately - architect is started lazily when needed
      if (config.role === 'product-manager') {
        this.splitScreen?.updateInitProgress(agent.id, 'initializing', 0);

        logger.info('Starting PM agent via AgentManager');

        // Start PM using AgentManager
        const handle = await this.agentManager.startAgent({
          role: 'product-manager',
          workflowName: this.workflowEngine.getFeatureName(),
          initialPrompt: systemPrompt,
          workingDirectory: this.config.workspaceRoot,
          autoFocus: true, // Focus PM window for user interaction
        });

        // Wait for Claude to be ready in background, then trigger onPMReady
        handle.waitForReady()
          .then(async () => {
            this.splitScreen?.updateInitProgress(agent.id, 'ready', 0);
            await this.onPMReady();
          })
          .catch((error) => {
            logger.error({ error }, 'PM failed to become ready');
            this.splitScreen?.updateInitProgress(agent.id, 'error', 0);
          });

        logger.info({ paneId: handle.paneId }, 'PM agent started');
      } else {
        // Architect and other core agents: register but don't start yet
        // They will be started lazily when first instruction is sent
        logger.info({ role: config.role }, 'Agent registered for lazy start');
      }

      // Store agent in local tracking
      this.agents.set(agent.id, agent);

      logger.info({ agentId: agent.id, role: agent.role }, 'Core agent created');
    }
  }

  /**
   * Called when PM Claude CLI is ready
   * @private
   */
  private async onPMReady(): Promise<void> {
    // Hide initialization panel
    this.splitScreen?.setInitializationComplete();

    // Get PM agent
    const pmAgent = this.agents.get('product-manager');
    if (!this.workflowEngine) return;

    // Create PM monitor (simplified - just watches for spec file)
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

    // Wait for Claude to fully process the system prompt before sending user prompt
    // This prevents race conditions where both prompts arrive too quickly
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send initial prompt to PM to kick off the conversation
    await this.sendInitialPromptToPM();

    // AgentManager auto-focuses the PM window, so it's already visible
    // Just update the UI to reflect that PM is ready
    this.splitScreen?.setPMTerminalOpened();
    logger.info('PM window opened via AgentManager');
  }

  /**
   * Send initial user prompt to PM to start the conversation
   * Uses AgentManager for message delivery
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

      // Use AgentManager to send message to PM
      const pmAgentId = toAgentId('product-manager');
      await this.agentManager.sendMessage(pmAgentId, initialPrompt);
      logger.info('Initial prompt sent to PM successfully');
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
   * Uses AgentManager for unified lifecycle management
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

    if (!this.workflowEngine) {
      throw new Error('Workflow engine not initialized');
    }

    // Generate the instruction to send
    const instruction = generateInstructions(agent.role, context);

    // Check if agent is already running via AgentManager
    const typedAgentId = toAgentId(agentId);
    const agentStatus = this.agentManager.getStatus(typedAgentId);

    if (!agentStatus || agentStatus === 'stopped' || agentStatus === 'error') {
      // Agent not running - start it via AgentManager
      logger.info({ agentId, role: agent.role }, 'Starting agent via AgentManager');

      const handle = await this.agentManager.startAgent({
        role: agent.role,
        workflowName: this.workflowEngine.getFeatureName(),
        initialPrompt: instruction, // Send instruction as initial prompt
        workingDirectory: this.config.workspaceRoot,
        autoFocus: true, // Focus the window when agent starts
      });

      // Wait for Claude to be ready
      await handle.waitForReady();

      // Focus the agent's window for visibility
      await this.agentManager.focusAgent(typedAgentId);
    } else if (agentStatus === 'ready' || agentStatus === 'working' || agentStatus === 'completed') {
      // Agent already running - send message via AgentManager
      logger.info({ agentId, role: agent.role, status: agentStatus }, 'Sending instruction to running agent');
      await this.agentManager.sendMessage(typedAgentId, instruction);

      // Focus the agent's window for visibility
      await this.agentManager.focusAgent(typedAgentId);
    } else {
      // Agent in starting or stuck state - wait and retry
      logger.warn({ agentId, status: agentStatus }, 'Agent in unexpected state, waiting...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.agentManager.sendMessage(typedAgentId, instruction);
    }

    // Update local agent status
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
   * Uses AgentManager for unified cleanup
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

      // Stop all agents via AgentManager (handles window cleanup)
      await this.agentManager.stopAll();
      logger.debug('All agents stopped via AgentManager');

      // Stop split screen
      this.splitScreen?.stop();

      // Stop file monitoring
      if (this.fileMonitor) {
        this.fileMonitor.stop();
        logger.debug('File monitor stopped');
      }

      // Clear local agents map
      this.agents.clear();

      logger.info('Cleanup complete');
    } catch (error) {
      logger.error({ error }, 'Error during cleanup');
      throw error;
    }
  }
}
