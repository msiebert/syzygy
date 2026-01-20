/**
 * Unit tests for AgentRunner
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AgentRunner } from '@core/agent-runner';
import { AgentRunnerError } from '../../src/types/message.types';
import type { AgentOutput } from '../../src/types/agent.types';

// Mock tmux-utils
const mockSendKeys = mock(async (_sessionName: string, _keys: string): Promise<void> => {
  return;
});

const mockCapturePane = mock(async (_sessionName: string): Promise<string> => {
  return 'Sample output';
});

mock.module('@utils/tmux-utils', () => ({
  sendKeys: mockSendKeys,
  capturePane: mockCapturePane,
}));

describe('AgentRunner', () => {
  let runner: AgentRunner;
  const agentId = 'test-agent-1';

  beforeEach(() => {
    runner = new AgentRunner();

    // Reset mocks
    mockSendKeys.mockClear();
    mockCapturePane.mockClear();

    // Reset to default implementations
    mockSendKeys.mockResolvedValue(undefined);
    mockCapturePane.mockResolvedValue('Sample output');
  });

  describe('sendInstruction', () => {
    it('should send instruction to agent', async () => {
      const instruction = 'Implement feature X';

      await runner.sendInstruction(agentId, instruction);

      expect(mockSendKeys).toHaveBeenCalledWith(agentId, instruction);
    });

    it('should throw AgentRunnerError on failure', async () => {
      mockSendKeys.mockRejectedValueOnce(new Error('Tmux error'));

      await expect(
        runner.sendInstruction(agentId, 'Test instruction')
      ).rejects.toThrow(AgentRunnerError);
    });

    it('should include agent ID in error', async () => {
      mockSendKeys.mockRejectedValueOnce(new Error('Tmux error'));

      try {
        await runner.sendInstruction(agentId, 'Test instruction');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentRunnerError);
        expect((error as AgentRunnerError).agentId).toBe(agentId);
      }
    });
  });

  describe('captureOutput', () => {
    it('should capture agent output', async () => {
      const output = await runner.captureOutput(agentId);

      expect(mockCapturePane).toHaveBeenCalledWith(agentId);
      expect(output).toBeDefined();
      expect(output.agentId).toBe(agentId);
      expect(output.content).toBe('Sample output');
      expect(output.timestamp).toBeInstanceOf(Date);
    });

    it('should detect completion markers', async () => {
      const testCases = [
        { output: 'Task completed successfully', expectedComplete: true },
        { output: 'Work finished', expectedComplete: true },
        { output: '[✓] Complete', expectedComplete: true },
        { output: 'Still working...', expectedComplete: false },
      ];

      for (const { output: text, expectedComplete } of testCases) {
        mockCapturePane.mockResolvedValueOnce(text);

        const output = await runner.captureOutput(agentId);

        expect(output.isComplete).toBe(expectedComplete);
      }
    });

    it('should detect error markers', async () => {
      const testCases = [
        { output: 'Error: Something went wrong', expectedError: true },
        { output: 'Failed: Test failed', expectedError: true },
        { output: 'Exception: Runtime error', expectedError: true },
        { output: '[✗] Failed', expectedError: true },
        { output: 'All tests passing', expectedError: false },
      ];

      for (const { output: text, expectedError } of testCases) {
        mockCapturePane.mockResolvedValueOnce(text);

        const output = await runner.captureOutput(agentId);

        expect(output.hasError).toBe(expectedError);
      }
    });

    it('should throw AgentRunnerError on capture failure', async () => {
      mockCapturePane.mockRejectedValueOnce(new Error('Capture error'));

      await expect(
        runner.captureOutput(agentId)
      ).rejects.toThrow(AgentRunnerError);
    });

    it('should analyze output correctly', async () => {
      mockCapturePane.mockResolvedValueOnce('Task completed\nAll tests passing');

      const output = await runner.captureOutput(agentId);

      expect(output.isComplete).toBe(true);
      expect(output.hasError).toBe(false);
    });
  });

  describe('waitForCompletion', () => {
    it('should return true when agent completes', async () => {
      // First poll: working, second poll: complete
      mockCapturePane
        .mockResolvedValueOnce('Working...')
        .mockResolvedValueOnce('Task completed');

      const result = await runner.waitForCompletion(agentId, 5000);

      expect(result).toBe(true);
    });

    it('should return false when error detected', async () => {
      mockCapturePane.mockResolvedValueOnce('Error: Something failed');

      const result = await runner.waitForCompletion(agentId, 5000);

      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      mockCapturePane.mockResolvedValue('Still working...');

      const result = await runner.waitForCompletion(agentId, 100);

      expect(result).toBe(false);
    }, 2000); // Increase test timeout

    it('should poll multiple times', async () => {
      mockCapturePane
        .mockResolvedValueOnce('Working... 1')
        .mockResolvedValueOnce('Working... 2')
        .mockResolvedValueOnce('Task completed');

      await runner.waitForCompletion(agentId, 5000);

      expect(mockCapturePane.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should throw AgentRunnerError on capture error', async () => {
      mockCapturePane.mockRejectedValueOnce(new Error('Capture failed'));

      await expect(
        runner.waitForCompletion(agentId, 5000)
      ).rejects.toThrow(AgentRunnerError);
    });
  });

  describe('monitorAgent', () => {
    it('should call onOutput callback periodically', async () => {
      const onOutput = mock((_output: AgentOutput) => {});

      mockCapturePane.mockResolvedValue('Working...');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        onOutput,
      });

      // Wait for a few polls
      await new Promise(resolve => setTimeout(resolve, 200));

      monitor.stop();

      expect(onOutput.mock.calls.length).toBeGreaterThan(1);
    });

    it('should call onComplete when agent finishes', async () => {
      const onComplete = mock(() => {});

      mockCapturePane
        .mockResolvedValueOnce('Working...')
        .mockResolvedValueOnce('Task completed');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        onComplete,
      });

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(onComplete).toHaveBeenCalledTimes(1);

      monitor.stop();
    });

    it('should call onError when error detected', async () => {
      const onError = mock((_error: Error) => {});

      mockCapturePane.mockResolvedValueOnce('Error: Test failed');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        onError,
      });

      // Wait for error detection
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(onError).toHaveBeenCalledTimes(1);

      monitor.stop();
    });

    it('should handle timeout', async () => {
      const onError = mock((_error: Error) => {});

      mockCapturePane.mockResolvedValue('Working...');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        timeout: 150,
        onError,
      });

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]?.message).toContain('timeout');

      monitor.stop();
    });

    it('should stop monitoring when stop is called', async () => {
      const onOutput = mock((_output: AgentOutput) => {});

      mockCapturePane.mockResolvedValue('Working...');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        onOutput,
      });

      // Wait for a couple polls
      await new Promise(resolve => setTimeout(resolve, 120));

      const callCountBeforeStop = onOutput.mock.calls.length;

      monitor.stop();

      // Wait to ensure no more calls
      await new Promise(resolve => setTimeout(resolve, 120));

      // Should not have been called again after stop
      expect(onOutput.mock.calls.length).toBe(callCountBeforeStop);
    });

    it('should handle errors in callbacks gracefully', async () => {
      const onOutput = mock((_output: AgentOutput) => {
        throw new Error('Callback error');
      });

      mockCapturePane.mockResolvedValue('Working...');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        onOutput,
      });

      // Should not throw
      await new Promise(resolve => setTimeout(resolve, 120));

      monitor.stop();

      // Callback should still have been called
      expect(onOutput).toHaveBeenCalled();
    });

    it('should stop on capture error', async () => {
      const onError = mock((_error: Error) => {});

      mockCapturePane
        .mockResolvedValueOnce('Working...')
        .mockRejectedValueOnce(new Error('Capture failed'));

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 50,
        onError,
      });

      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(onError).toHaveBeenCalledTimes(1);

      monitor.stop();
    });

    it('should use default poll interval if not specified', async () => {
      const onOutput = mock((_output: AgentOutput) => {});

      mockCapturePane.mockResolvedValue('Working...');

      const monitor = runner.monitorAgent(agentId, {
        onOutput,
      });

      // Wait for default interval (1000ms)
      await new Promise(resolve => setTimeout(resolve, 1200));

      monitor.stop();

      // Should have been called at least once
      expect(onOutput).toHaveBeenCalled();
    });

    it('should perform initial poll immediately', async () => {
      const onOutput = mock((_output: AgentOutput) => {});

      mockCapturePane.mockResolvedValue('Working...');

      const monitor = runner.monitorAgent(agentId, {
        pollInterval: 5000, // Very long interval
        onOutput,
      });

      // Wait a short time (less than interval)
      await new Promise(resolve => setTimeout(resolve, 100));

      monitor.stop();

      // Should have been called at least once immediately
      expect(onOutput).toHaveBeenCalled();
    });
  });
});
