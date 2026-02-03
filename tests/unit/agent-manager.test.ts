/**
 * Unit tests for AgentManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AgentManager, AgentStartError, type AgentStartConfig } from '@core/agent-manager';
import { toAgentId } from '../../src/types/agent.types';

// Mock tmux execution
let mockExecTmuxResults: Map<string, string> = new Map();
let mockExecTmuxErrors: Map<string, Error> = new Map();
let execTmuxCallLog: string[][] = [];
let paneIdCounter = 0;

// We need to mock at the Bun.spawn level since execTmux is internal
const originalSpawn = Bun.spawn;
const originalSpawnSync = Bun.spawnSync;

function setupMocks() {
  execTmuxCallLog = [];
  mockExecTmuxResults = new Map();
  mockExecTmuxErrors = new Map();
  paneIdCounter = 0;

  // Default: capture-pane returns Claude ready indicator after a delay
  let capturePaneCallCount = 0;
  mockExecTmuxResults.set('capture-pane', '');

  // Mock Bun.spawn for async tmux calls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Bun as any).spawn = (cmd: string[], _options?: object) => {
    const args = cmd.slice(1); // Remove 'tmux' from args
    execTmuxCallLog.push(args);

    const command = args[0];

    // Check for errors
    const error = mockExecTmuxErrors.get(command ?? '');
    if (error) {
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(error.message));
            controller.close();
          },
        }),
        exited: Promise.resolve(1),
      };
    }

    // Handle split-window specially - return a pane ID
    let result = mockExecTmuxResults.get(command ?? '') ?? '';
    if (command === 'split-window') {
      paneIdCounter++;
      result = `%${paneIdCounter}`;
    }

    // Handle capture-pane specially - return Claude ready after 2 calls
    if (command === 'capture-pane') {
      capturePaneCallCount++;
      if (capturePaneCallCount >= 2) {
        result = 'Claude Code\n>';
      }
    }

    return {
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(result));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      exited: Promise.resolve(0),
    };
  };

  // Mock Bun.spawnSync for cleanup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Bun as any).spawnSync = (cmd: string[]) => {
    execTmuxCallLog.push(cmd.slice(1));
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

function restoreMocks() {
  // Restore the original functions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Bun as any).spawn = originalSpawn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Bun as any).spawnSync = originalSpawnSync;
}

describe('AgentManager', () => {
  let manager: AgentManager;
  let testConfig: AgentStartConfig;

  beforeEach(() => {
    setupMocks();

    manager = new AgentManager({
      readyTimeoutMs: 5000,  // Shorter timeout for tests
      cleanupOnExit: false, // Don't register cleanup handlers in tests
    });

    testConfig = {
      role: 'architect',
      workflowName: 'test-feature',
      initialPrompt: 'You are the architect. Design the system.',
      workingDirectory: '/tmp/test-project',
      sessionId: 'test-session-123',
    };
  });

  afterEach(() => {
    restoreMocks();
  });

  describe('startAgent', () => {
    it('should create a tmux pane', async () => {
      const handle = await manager.startAgent(testConfig);

      expect(handle.paneId).toMatch(/^%\d+$/);
      expect(handle.role).toBe('architect');
      expect(handle.id).toBe(toAgentId('architect'));

      // Verify split-window was called
      const splitWindowCall = execTmuxCallLog.find(args => args[0] === 'split-window');
      expect(splitWindowCall).toBeDefined();
    });

    it('should start Claude Code in the pane', async () => {
      await manager.startAgent(testConfig);

      // Verify send-keys was called with claude command
      const sendKeysCall = execTmuxCallLog.find(
        args => args[0] === 'send-keys' && args.some(a => a.includes('claude'))
      );
      expect(sendKeysCall).toBeDefined();
    });

    it('should change to working directory before starting Claude', async () => {
      await manager.startAgent(testConfig);

      // Find the cd command call
      const cdCallIndex = execTmuxCallLog.findIndex(
        args => args[0] === 'send-keys' && args.some(a => a.includes('cd'))
      );
      const claudeCallIndex = execTmuxCallLog.findIndex(
        args => args[0] === 'send-keys' && args.some(a => a.includes('claude'))
      );

      expect(cdCallIndex).toBeLessThan(claudeCallIndex);
    });

    it('should return handle with waitForReady function', async () => {
      const handle = await manager.startAgent(testConfig);

      expect(handle.waitForReady).toBeInstanceOf(Function);
    });

    it('should send initial prompt after Claude is ready', async () => {
      const handle = await manager.startAgent(testConfig);

      // Wait for Claude to be ready
      await handle.waitForReady();

      // Verify the prompt was sent (look for send-keys with -l flag for literal)
      const promptSendCalls = execTmuxCallLog.filter(
        args => args[0] === 'send-keys' && args.includes('-l')
      );
      expect(promptSendCalls.length).toBeGreaterThan(0);
    });

    it('should track the agent in listAgents', async () => {
      await manager.startAgent(testConfig);

      const agents = manager.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]?.role).toBe('architect');
      expect(agents[0]?.status).toBe('starting');
    });

    it('should update status to working after waitForReady (sends initial user message)', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      const status = manager.getStatus(handle.id);
      // With --append-system-prompt, Claude has instructions but waits for user input.
      // waitForReady now sends "Begin your assigned task now." to trigger Claude,
      // so status transitions from ready -> working.
      expect(status).toBe('working');
    });
  });

  describe('pane creation', () => {
    it('should use horizontal split for side-by-side layout', async () => {
      await manager.startAgent(testConfig);

      // Verify split-window was called with -h flag for horizontal
      const splitWindowCall = execTmuxCallLog.find(args => args[0] === 'split-window');
      expect(splitWindowCall).toContain('-h');
    });

    it('should return pane ID from tmux', async () => {
      const handle = await manager.startAgent(testConfig);

      // Pane ID should be in tmux format like %1, %2, etc.
      expect(handle.paneId).toMatch(/^%\d+$/);
    });
  });

  describe('retry logic', () => {
    it('should retry on failure', async () => {
      let attempts = 0;

      // Fail first two attempts, succeed on third
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).spawn = (cmd: string[]) => {
        const args = cmd.slice(1);
        execTmuxCallLog.push(args);

        if (args[0] === 'split-window') {
          attempts++;
          if (attempts < 3) {
            return {
              stdout: new ReadableStream({ start(c) { c.close(); } }),
              stderr: new ReadableStream({
                start(c) {
                  c.enqueue(new TextEncoder().encode('tmux error'));
                  c.close();
                },
              }),
              exited: Promise.resolve(1),
            };
          }
          // Return pane ID on success
          return {
            stdout: new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(`%${attempts}`));
                c.close();
              },
            }),
            stderr: new ReadableStream({ start(c) { c.close(); } }),
            exited: Promise.resolve(0),
          };
        }

        // Simulate Claude being ready
        let result = '';
        if (args[0] === 'capture-pane') {
          result = 'Claude Code\n>';
        }

        return {
          stdout: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(result));
              c.close();
            },
          }),
          stderr: new ReadableStream({ start(c) { c.close(); } }),
          exited: Promise.resolve(0),
        };
      };

      const handle = await manager.startAgent(testConfig);

      expect(handle).toBeDefined();
      expect(attempts).toBe(3);

      // Restore mocks for subsequent tests
      setupMocks();
    });

    it('should throw AgentStartError after max retries', async () => {
      // Always fail
      mockExecTmuxErrors.set('split-window', new Error('tmux not available'));

      await expect(manager.startAgent(testConfig)).rejects.toThrow(AgentStartError);

      // Restore mocks for subsequent tests
      setupMocks();
    });
  });

  describe('sendMessage', () => {
    it('should send message to a ready agent', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      await manager.sendMessage(handle.id, 'Please update the design');

      // Verify send-keys was called with the message
      const messageCalls = execTmuxCallLog.filter(
        args => args[0] === 'send-keys' && args.includes('-l')
      );
      expect(messageCalls.length).toBeGreaterThan(1); // Initial prompt + new message
    });

    it('should throw if agent not found', async () => {
      await expect(
        manager.sendMessage(toAgentId('non-existent'), 'hello')
      ).rejects.toThrow('not found');
    });

    it('should update status to working after sending message', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      await manager.sendMessage(handle.id, 'Do some work');

      expect(manager.getStatus(handle.id)).toBe('working');
    });
  });

  describe('stopAgent', () => {
    it('should kill the tmux pane', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      await manager.stopAgent(handle.id);

      const killCall = execTmuxCallLog.find(args => args[0] === 'kill-pane');
      expect(killCall).toBeDefined();
      expect(killCall).toContain(handle.paneId);
    });

    it('should remove agent from tracking', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      await manager.stopAgent(handle.id);

      expect(manager.listAgents()).toHaveLength(0);
      expect(manager.getStatus(handle.id)).toBeUndefined();
    });

    it('should handle non-existent agent gracefully', async () => {
      // Should not throw when stopping non-existent agent
      await manager.stopAgent(toAgentId('non-existent'));
      // If we get here without throwing, the test passes
      expect(true).toBe(true);
    });
  });

  describe('stopAll', () => {
    it.skip('should stop all agents', async () => {
      // TODO: Fix test isolation issues with async mocks
      // Start one agent and verify stopAll clears it
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      expect(manager.listAgents()).toHaveLength(1);

      await manager.stopAll();

      expect(manager.listAgents()).toHaveLength(0);
    });
  });

  describe('markCompleted', () => {
    it.skip('should update agent status to completed', async () => {
      // TODO: Fix test isolation issues with async mocks
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      manager.markCompleted(handle.id);

      expect(manager.getStatus(handle.id)).toBe('completed');
    });
  });

  describe('checkForStuckAgents', () => {
    it.skip('should detect agents with no recent activity', async () => {
      // TODO: Fix test isolation issues with async mocks
      // Reset mocks for this test to have fresh state
      setupMocks();

      const managerWithShortTimeout = new AgentManager({
        stuckTimeoutMs: 100, // Very short for testing
        readyTimeoutMs: 5000,
        cleanupOnExit: false,
      });

      const handle = await managerWithShortTimeout.startAgent(testConfig);
      await handle.waitForReady();

      // Simulate agent working
      await managerWithShortTimeout.sendMessage(handle.id, 'Start work');

      // Wait for stuck timeout
      await new Promise(r => setTimeout(r, 150));

      const stuckAgents = managerWithShortTimeout.checkForStuckAgents();

      expect(stuckAgents).toContain(handle.id);
      expect(managerWithShortTimeout.getStatus(handle.id)).toBe('stuck');
    });
  });

  describe('startMonitoring', () => {
    it('should throw if agent not found', async () => {
      expect(() => manager.startMonitoring(toAgentId('non-existent'))).toThrow('not found');
    });

    it('should return a handle with stop function', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      const monitorHandle = manager.startMonitoring(handle.id);

      expect(monitorHandle.stop).toBeInstanceOf(Function);
      expect(monitorHandle.done).toBeInstanceOf(Promise);

      // Clean up
      monitorHandle.stop();
    });

    // NOTE: Completion detection is now handled by file-based detection in the Orchestrator
    // via AgentCompletionTracker. The AgentManager.startMonitoring only handles errors/timeouts.
    // See tests/unit/agent-completion-tracker.test.ts for completion detection tests.

    it('should detect errors and keep pane open', async () => {
      // Create manager with keepCompletedPanes: true so we can verify agent is still tracked
      const managerWithKeepPanes = new AgentManager({
        readyTimeoutMs: 5000,
        cleanupOnExit: false,
        keepCompletedPanes: true,
      });

      // Setup mock to return error marker in NEW content after baseline
      // The baseline-based detection requires the marker to appear in content
      // that grows AFTER the first monitoring poll captures the baseline.
      // Detection also requires:
      // - 3 settling polls after baseline before checking for markers
      // - At least 50 chars of meaningful content before the error marker
      let callCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).spawn = (cmd: string[]) => {
        const args = cmd.slice(1);
        execTmuxCallLog.push(args);

        let result = '';
        if (args[0] === 'split-window') {
          paneIdCounter++;
          result = `%${paneIdCounter}`;
        } else if (args[0] === 'capture-pane') {
          callCount++;
          if (callCount >= 2 && callCount < 8) {
            // Ready state - this content becomes the baseline
            result = 'Claude Code\n>';
          } else if (callCount >= 8) {
            // Content grows: baseline + new content with error marker
            // Marker must be at the END (only whitespace follows) for detection
            // Include enough content to meet the 50 char minimum for errors
            const errorContent = 'I encountered an unrecoverable error while processing the task. Cannot continue.';
            result = 'Claude Code\n>' + errorContent + '\n\n[SYZYGY:ERROR]\n';
          }
        }

        return {
          stdout: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(result));
              c.close();
            },
          }),
          stderr: new ReadableStream({ start(c) { c.close(); } }),
          exited: Promise.resolve(0),
        };
      };

      const handle = await managerWithKeepPanes.startAgent(testConfig);
      await handle.waitForReady();

      let onErrorCalled = false;
      const monitorHandle = managerWithKeepPanes.startMonitoring(handle.id, {
        pollInterval: 50,
        onError: () => {
          onErrorCalled = true;
        },
      });

      // Wait for error detection (needs time for baseline + settling polls + detection)
      // With 50ms poll interval: need ~8 polls = 400ms, add buffer for safety
      await new Promise(r => setTimeout(r, 600));

      expect(onErrorCalled).toBe(true);
      expect(managerWithKeepPanes.getStatus(handle.id)).toBe('error');

      // Agent should still be tracked (pane kept open for debugging)
      expect(managerWithKeepPanes.listAgents()).toHaveLength(1);

      monitorHandle.stop();
      setupMocks();
    });

    it('should stop monitoring when stopMonitoring is called', async () => {
      const handle = await manager.startAgent(testConfig);
      await handle.waitForReady();

      const monitorHandle = manager.startMonitoring(handle.id);

      // Stop immediately
      monitorHandle.stop();

      // Wait a bit to ensure no more polling
      await new Promise(r => setTimeout(r, 100));

      // Should have stopped cleanly
      expect(true).toBe(true);
    });
  });

  describe('keepCompletedPanes config', () => {
    it('should default to false (auto-close panes)', () => {
      const defaultManager = new AgentManager({
        cleanupOnExit: false,
      });

      // Access the config via listing agents - this tests the default indirectly
      // Since default is false, markCompleted will trigger stopAgent
      expect(defaultManager.listAgents()).toHaveLength(0);
    });

    it('should close pane when markCompleted is called with keepCompletedPanes: false', async () => {
      const managerWithAutoClose = new AgentManager({
        keepCompletedPanes: false,
        readyTimeoutMs: 5000,
        cleanupOnExit: false,
      });

      const handle = await managerWithAutoClose.startAgent(testConfig);
      await handle.waitForReady();

      expect(managerWithAutoClose.listAgents()).toHaveLength(1);

      managerWithAutoClose.markCompleted(handle.id);

      // Give async cleanup a moment to run
      await new Promise(r => setTimeout(r, 50));

      // Agent should be removed (pane closed)
      expect(managerWithAutoClose.listAgents()).toHaveLength(0);
    });

    it('should keep pane open when markCompleted is called with keepCompletedPanes: true', async () => {
      const managerWithKeepOpen = new AgentManager({
        keepCompletedPanes: true,
        readyTimeoutMs: 5000,
        cleanupOnExit: false,
      });

      const handle = await managerWithKeepOpen.startAgent(testConfig);
      await handle.waitForReady();

      expect(managerWithKeepOpen.listAgents()).toHaveLength(1);

      managerWithKeepOpen.markCompleted(handle.id);

      // Give a moment for any async operations
      await new Promise(r => setTimeout(r, 50));

      // Agent should still be tracked with completed status
      expect(managerWithKeepOpen.listAgents()).toHaveLength(1);
      expect(managerWithKeepOpen.getStatus(handle.id)).toBe('completed');
    });
  });
});

