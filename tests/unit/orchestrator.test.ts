/**
 * Unit tests for Orchestrator
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Orchestrator } from '../../src/core/orchestrator.js';
import type { Agent } from '../../src/types/agent.types.js';
import { toSessionName } from '../../src/types/agent.types.js';
import type { TmuxSession } from '../../src/types/message.types.js';

// Mock modules
const mockSessionManager = {
  createAgentSession: mock(async (agent: Agent): Promise<TmuxSession> => ({
    name: agent.sessionName,
    agentId: agent.id,
    windowId: 'mock-window',
    paneId: 'mock-pane',
    pid: 12345,
    createdAt: new Date(),
  })),
  destroyAgentSession: mock(async (_agentId: string) => {}),
  cleanupAllSessions: mock(async () => {}),
  getSession: mock((_agentId: string) => undefined),
  getAllSessions: mock(() => []),
};

const mockWorkflowEngine = {
  getCurrentState: mock(() => 'idle' as const),
  getContext: mock(() => ({
    featureName: 'test-feature',
    state: 'idle' as const,
    startedAt: new Date(),
  })),
  canTransition: mock(() => true),
  transitionTo: mock(() => {}),
  transitionToError: mock(() => {}),
  on: mock(() => {}),
  emit: mock(() => {}),
};

const mockFileMonitor = {
  addWatchPath: mock(() => {}),
  start: mock(() => {}),
  stop: mock(() => {}),
  on: mock(() => {}),
};

const mockAgentRunner = {
  sendInstruction: mock(async () => {}),
  captureOutput: mock(async () => ({
    agentId: 'test-agent',
    content: 'test output',
    timestamp: new Date(),
    isComplete: false,
    hasError: false,
  })),
  waitForCompletion: mock(async () => true),
  monitorAgent: mock(() => {}),
};

const mockStageManager = {
  initializeStages: mock(async () => {}),
  moveArtifact: mock(async () => {}),
  listPendingArtifacts: mock(async () => []),
  getStage: mock(() => undefined),
};

// Mock imports
mock.module('../../src/core/session-manager.js', () => ({
  SessionManager: mock(() => mockSessionManager),
}));

mock.module('../../src/core/workflow-engine.js', () => ({
  WorkflowEngine: mock(() => mockWorkflowEngine),
}));

mock.module('../../src/core/file-monitor.js', () => ({
  FileMonitor: mock(() => mockFileMonitor),
}));

mock.module('../../src/core/agent-runner.js', () => ({
  AgentRunner: mock(() => mockAgentRunner),
}));

mock.module('../../src/stages/stage-manager.js', () => ({
  StageManager: mock(() => mockStageManager),
}));

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    // Reset all mocks before each test
    mockSessionManager.createAgentSession.mockClear();
    mockSessionManager.destroyAgentSession.mockClear();
    mockSessionManager.cleanupAllSessions.mockClear();
    mockWorkflowEngine.transitionTo.mockClear();
    mockWorkflowEngine.transitionToError.mockClear();
    mockFileMonitor.addWatchPath.mockClear();
    mockFileMonitor.start.mockClear();
    mockFileMonitor.stop.mockClear();
    mockFileMonitor.on.mockClear();
    mockAgentRunner.sendInstruction.mockClear();
    mockStageManager.initializeStages.mockClear();
  });

  afterEach(async () => {
    // Cleanup after each test
    if (orchestrator) {
      try {
        await orchestrator.stopWorkflow();
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe('constructor', () => {
    it('should create orchestrator with default config', () => {
      orchestrator = new Orchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator.getWorkflowState()).toBe('idle');
    });

    it('should create orchestrator with custom config', () => {
      orchestrator = new Orchestrator({
        numDevelopers: 3,
        workspaceRoot: '/custom/path',
        pollInterval: 5000,
      });
      expect(orchestrator).toBeDefined();
    });

    it('should initialize with empty agents list', () => {
      orchestrator = new Orchestrator();
      expect(orchestrator.getActiveAgents()).toHaveLength(0);
    });
  });

  describe('startWorkflow', () => {
    it('should initialize workspace and create core agents', async () => {
      orchestrator = new Orchestrator();

      await orchestrator.startWorkflow('test-feature');

      // Should initialize stages
      expect(mockStageManager.initializeStages).toHaveBeenCalled();

      // Should create core agents (PM and Architect)
      expect(mockSessionManager.createAgentSession).toHaveBeenCalledTimes(2);

      // Should start file monitoring
      expect(mockFileMonitor.start).toHaveBeenCalled();
    });

    it('should transition to spec_pending state', async () => {
      orchestrator = new Orchestrator();

      await orchestrator.startWorkflow('test-feature');

      expect(mockWorkflowEngine.transitionTo).toHaveBeenCalledWith('spec_pending');
    });

    it('should send instruction to Product Manager', async () => {
      orchestrator = new Orchestrator();

      await orchestrator.startWorkflow('test-feature');

      expect(mockAgentRunner.sendInstruction).toHaveBeenCalled();
      const calls = mockAgentRunner.sendInstruction.mock.calls as unknown as [string, string][];
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0]!;
      const [agentId, instruction] = firstCall;
      expect(agentId).toBe('product-manager');
      expect(instruction).toContain('test-feature');
    });

    it('should setup file monitoring for all stages', async () => {
      orchestrator = new Orchestrator();

      await orchestrator.startWorkflow('test-feature');

      // Should watch all 7 stage pending directories
      expect(mockFileMonitor.addWatchPath).toHaveBeenCalledTimes(7);
    });

    it('should throw error if workflow is already running', async () => {
      orchestrator = new Orchestrator();

      await orchestrator.startWorkflow('test-feature-1');

      await expect(orchestrator.startWorkflow('test-feature-2')).rejects.toThrow(
        'Workflow is already running'
      );
    });

    it('should cleanup on startup failure', async () => {
      orchestrator = new Orchestrator();

      // Mock initialization failure
      mockStageManager.initializeStages.mockRejectedValueOnce(new Error('Init failed'));

      await expect(orchestrator.startWorkflow('test-feature')).rejects.toThrow('Init failed');

      // Should cleanup sessions
      expect(mockSessionManager.cleanupAllSessions).toHaveBeenCalled();
    });
  });

  describe('stopWorkflow', () => {
    it('should stop file monitor', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      await orchestrator.stopWorkflow();

      expect(mockFileMonitor.stop).toHaveBeenCalled();
    });

    it('should cleanup all sessions', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      await orchestrator.stopWorkflow();

      expect(mockSessionManager.cleanupAllSessions).toHaveBeenCalled();
    });

    it('should clear agents list', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      expect(orchestrator.getActiveAgents().length).toBeGreaterThan(0);

      await orchestrator.stopWorkflow();

      expect(orchestrator.getActiveAgents()).toHaveLength(0);
    });
  });

  describe('getWorkflowState', () => {
    it('should return idle when no workflow is running', () => {
      orchestrator = new Orchestrator();
      expect(orchestrator.getWorkflowState()).toBe('idle');
    });

    it('should return current state from workflow engine', async () => {
      orchestrator = new Orchestrator();
      // @ts-expect-error - mock return type mismatch
      mockWorkflowEngine.getCurrentState.mockReturnValueOnce('spec_pending');

      await orchestrator.startWorkflow('test-feature');

      expect(orchestrator.getWorkflowState()).toBe('spec_pending');
    });
  });

  describe('getActiveAgents', () => {
    it('should return empty array initially', () => {
      orchestrator = new Orchestrator();
      expect(orchestrator.getActiveAgents()).toEqual([]);
    });

    it('should return core agents after startup', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const agents = orchestrator.getActiveAgents();
      expect(agents.length).toBeGreaterThan(0);

      // Should have PM and Architect
      const roles = agents.map(a => a.role);
      expect(roles).toContain('product-manager');
      expect(roles).toContain('architect');
    });
  });

  describe('getAgent', () => {
    it('should return undefined for non-existent agent', () => {
      orchestrator = new Orchestrator();
      expect(orchestrator.getAgent('non-existent')).toBeUndefined();
    });

    it('should return agent by ID after creation', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const pmAgent = orchestrator.getAgent('product-manager');
      expect(pmAgent).toBeDefined();
      expect(pmAgent?.role).toBe('product-manager');
    });
  });

  describe('agent lifecycle', () => {
    it('should create PM agent with correct session name', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const pmAgent = orchestrator.getAgent('product-manager');
      expect(pmAgent?.sessionName).toBe(toSessionName('syzygy-pm'));
    });

    it('should create Architect agent with correct session name', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const archAgent = orchestrator.getAgent('architect');
      expect(archAgent?.sessionName).toBe(toSessionName('syzygy-architect'));
    });

    it('should set PM agent status to working after instruction sent', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const pmAgent = orchestrator.getAgent('product-manager');
      expect(pmAgent?.status).toBe('working');
    });
  });

  describe('file monitoring setup', () => {
    it('should watch spec/pending directory', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const calls = mockFileMonitor.addWatchPath.mock.calls as unknown as [string][];
      const specPendingCall = calls.find(([path]) => path && path.includes('spec/pending'));
      expect(specPendingCall).toBeDefined();
    });

    it('should watch all stage pending directories', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      const stages = ['spec', 'arch', 'tasks', 'tests', 'impl', 'review', 'docs'];
      const calls = (mockFileMonitor.addWatchPath.mock.calls as unknown as [string][]).map(([path]) => path);

      for (const stage of stages) {
        const hasStage = calls.some((path: string) => path && path.includes(`${stage}/pending`));
        expect(hasStage).toBe(true);
      }
    });

    it('should listen for artifact:created events', async () => {
      orchestrator = new Orchestrator();
      await orchestrator.startWorkflow('test-feature');

      expect(mockFileMonitor.on).toHaveBeenCalledWith('artifact:created', expect.any(Function));
    });
  });

  describe('error handling', () => {
    it('should handle session creation failure', async () => {
      orchestrator = new Orchestrator();

      mockSessionManager.createAgentSession.mockRejectedValueOnce(
        new Error('Session creation failed')
      );

      await expect(orchestrator.startWorkflow('test-feature')).rejects.toThrow();
    });

    it('should cleanup on error during startup', async () => {
      orchestrator = new Orchestrator();

      mockWorkflowEngine.transitionTo.mockImplementationOnce(() => {
        throw new Error('Transition failed');
      });

      await expect(orchestrator.startWorkflow('test-feature')).rejects.toThrow();

      // Should attempt cleanup
      expect(mockSessionManager.cleanupAllSessions).toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('should use custom workspace root', async () => {
      orchestrator = new Orchestrator({ workspaceRoot: '/custom/path' });
      await orchestrator.startWorkflow('test-feature');

      const calls = mockStageManager.initializeStages.mock.calls as unknown as [string][];
      expect(calls.length).toBeGreaterThan(0);
      const firstArg = calls[0]?.[0];
      expect(firstArg).toBeDefined();
      expect(typeof firstArg).toBe('string');
      expect(firstArg).toContain('/custom/path');
    });

    it('should pass workspace root to stage manager', async () => {
      orchestrator = new Orchestrator({ workspaceRoot: '/test/root' });
      await orchestrator.startWorkflow('test-feature');

      expect(mockStageManager.initializeStages).toHaveBeenCalledWith(
        expect.stringContaining('/test/root/.syzygy')
      );
    });
  });
});
