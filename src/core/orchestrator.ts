/**
 * Main orchestration engine
 * Coordinates all agents through the workflow
 */

import type { WorkflowState, WorkflowEvent } from '../types/workflow.types.js';
import type { Agent, AgentRole } from '../types/agent.types.js';
import { SessionManager } from './session-manager.js';
import { WorkflowEngine } from './workflow-engine.js';
import { FileMonitor } from './file-monitor.js';
import { AgentRunner } from './agent-runner.js';
import { StageManager } from '../stages/stage-manager.js';
import {
  getAlwaysRunningAgents,
  getSessionName,
} from '../agents/agent-config.js';
import {
  generateInstructions,
  type InstructionContext,
} from '../agents/agent-instructions.js';
import { createModuleLogger } from '@utils/logger';
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
  async startWorkflow(featureName: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Workflow is already running');
    }

    logger.info({ featureName }, 'Starting workflow');

    try {
      // Initialize workflow engine
      this.workflowEngine = new WorkflowEngine(featureName);

      // Initialize workspace (create stage directories)
      const workspaceRoot = path.join(this.config.workspaceRoot, '.syzygy');
      await this.stageManager.initializeStages(workspaceRoot);
      logger.info('Workspace initialized');

      // Setup file monitoring
      this.setupFileMonitoring();

      // Create always-running agents (PM and Architect)
      await this.createCoreAgents();
      logger.info('Core agents created');

      // Transition to spec_pending state
      this.workflowEngine.transitionTo('spec_pending');

      // Send initial instruction to Product Manager
      await this.sendPMInstruction(featureName);

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
        id: config.role,
        role: config.role,
        sessionName: getSessionName(config.role),
        status: 'idle',
      };

      // Create tmux session
      await this.sessionManager.createAgentSession(agent);

      // Store agent
      this.agents.set(agent.id, agent);

      logger.info({ agentId: agent.id, role: agent.role }, 'Core agent created');
    }
  }

  /**
   * Send initial instruction to Product Manager
   * @private
   */
  private async sendPMInstruction(featureName: string): Promise<void> {
    const pmAgent = this.agents.get('product-manager');
    if (!pmAgent) {
      throw new Error('Product Manager agent not found');
    }

    const context: InstructionContext = {
      featureName,
    };

    const instruction = generateInstructions('product-manager', context);

    await this.agentRunner.sendInstruction(pmAgent.id, instruction);

    // Update agent status
    pmAgent.status = 'working';
    this.agents.set(pmAgent.id, pmAgent);

    logger.info({ featureName }, 'PM instruction sent');
  }

  /**
   * Handle artifact created event
   * @private
   */
  private async handleArtifactCreated(event: WorkflowEvent): Promise<void> {
    logger.info({ event }, 'Handling artifact created');

    // TODO: Implement artifact handling logic
    // 1. Determine which agent should process the artifact
    // 2. Create agent session if needed (on-demand agents)
    // 3. Send instructions to agent
    // 4. Monitor agent progress
    // 5. Transition workflow state when stage completes
  }

  /**
   * Create an on-demand agent if needed
   * Used by handleArtifactCreated (to be implemented)
   * @private
   */
  // @ts-expect-error - Used in future implementation
  private async createAgentIfNeeded(
    role: AgentRole,
    instance?: number
  ): Promise<Agent> {
    const agentId = instance !== undefined ? `${role}-${instance}` : role;

    // Check if agent already exists
    let agent = this.agents.get(agentId);
    if (agent) {
      return agent;
    }

    // Create new agent
    agent = {
      id: agentId,
      role,
      sessionName: getSessionName(role, instance),
      status: 'idle',
    };

    await this.sessionManager.createAgentSession(agent);
    this.agents.set(agentId, agent);

    logger.info({ agentId, role }, 'On-demand agent created');

    return agent;
  }

  /**
   * Send instruction to an agent
   * Used by handleArtifactCreated (to be implemented)
   * @private
   */
  // @ts-expect-error - Used in future implementation
  private async sendInstructionToAgent(
    agentId: string,
    context: InstructionContext
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const instruction = generateInstructions(agent.role, context);
    await this.agentRunner.sendInstruction(agentId, instruction);

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
   * Used by handleArtifactCreated (to be implemented)
   * @private
   */
  // @ts-expect-error - Used in future implementation
  private async monitorAgentWork(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    try {
      // Wait for completion with timeout
      const completed = await this.agentRunner.waitForCompletion(
        agentId,
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
   * Used by handleArtifactCreated (to be implemented)
   * @private
   */
  // @ts-expect-error - Used in future implementation
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
   * Cleanup resources (sessions, monitors)
   * @private
   */
  private async cleanup(): Promise<void> {
    logger.info('Cleaning up orchestrator resources');

    try {
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
