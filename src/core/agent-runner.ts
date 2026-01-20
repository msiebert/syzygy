/**
 * Agent instruction handling and output monitoring
 */

import type {
  AgentOutput,
  AgentMonitorOptions,
} from '../types/agent.types.js';
import { AgentRunnerError } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';
import { sendKeys, capturePane } from '@utils/tmux-utils';

const logger = createModuleLogger('agent-runner');

/**
 * Patterns to detect completion or errors in agent output
 */
const COMPLETION_MARKERS = [
  /task\s+(?:complete|completed|finish|finished|done)/i,
  /successfully\s+(?:complete|completed|finish|finished)/i,
  /\[✓\]\s+(?:complete|done)/i,
  /work\s+finished/i,
];

const ERROR_MARKERS = [
  /error:/i,
  /failed:/i,
  /exception:/i,
  /\[✗\]\s+failed/i,
];

export class AgentRunner {
  /**
   * Send an instruction to an agent
   */
  async sendInstruction(agentId: string, instruction: string): Promise<void> {
    logger.info({ agentId, instructionLength: instruction.length }, 'Sending instruction to agent');

    try {
      // Send instruction via tmux
      await sendKeys(agentId, instruction);

      logger.info({ agentId }, 'Instruction sent successfully');
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to send instruction');

      throw new AgentRunnerError(
        `Failed to send instruction to agent ${agentId}`,
        agentId,
        { originalError: error }
      );
    }
  }

  /**
   * Capture current output from an agent
   */
  async captureOutput(agentId: string): Promise<AgentOutput> {
    logger.debug({ agentId }, 'Capturing agent output');

    try {
      const content = await capturePane(agentId);

      // Analyze output for completion and errors
      const isComplete = this.detectCompletion(content);
      const hasError = this.detectError(content);

      const output: AgentOutput = {
        agentId,
        content,
        timestamp: new Date(),
        isComplete,
        hasError,
      };

      logger.debug(
        { agentId, lines: content.split('\n').length, isComplete, hasError },
        'Output captured and analyzed'
      );

      return output;
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to capture output');

      throw new AgentRunnerError(
        `Failed to capture output from agent ${agentId}`,
        agentId,
        { originalError: error }
      );
    }
  }

  /**
   * Wait for agent to complete a task
   */
  async waitForCompletion(agentId: string, timeout: number): Promise<boolean> {
    logger.info({ agentId, timeout }, 'Waiting for agent completion');

    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    try {
      while (Date.now() - startTime < timeout) {
        const output = await this.captureOutput(agentId);

        if (output.hasError) {
          logger.warn({ agentId }, 'Error detected in agent output');
          return false;
        }

        if (output.isComplete) {
          logger.info({ agentId }, 'Agent completed successfully');
          return true;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      logger.warn({ agentId, timeout }, 'Timeout waiting for agent completion');
      return false;
    } catch (error) {
      logger.error({ agentId, error }, 'Error while waiting for completion');

      throw new AgentRunnerError(
        `Error while waiting for agent ${agentId} to complete`,
        agentId,
        { originalError: error }
      );
    }
  }

  /**
   * Monitor an agent with periodic callbacks
   */
  monitorAgent(
    agentId: string,
    options: AgentMonitorOptions
  ): { stop: () => void } {
    logger.info({ agentId, options }, 'Starting agent monitoring');

    const pollInterval = options.pollInterval ?? 1000;
    const startTime = Date.now();

    let stopped = false;
    let intervalId: Timer;

    const poll = async () => {
      if (stopped) {
        return;
      }

      try {
        const output = await this.captureOutput(agentId);

        // Call output callback if provided
        if (options.onOutput) {
          try {
            options.onOutput(output);
          } catch (error) {
            logger.error({ agentId, error }, 'Error in onOutput callback');
          }
        }

        // Check for completion
        if (output.isComplete) {
          logger.info({ agentId }, 'Agent completed during monitoring');

          if (options.onComplete) {
            try {
              options.onComplete();
            } catch (error) {
              logger.error({ agentId, error }, 'Error in onComplete callback');
            }
          }

          stopped = true;
          clearInterval(intervalId);
          return;
        }

        // Check for errors
        if (output.hasError) {
          logger.warn({ agentId }, 'Error detected during monitoring');

          if (options.onError) {
            try {
              options.onError(new Error('Agent error detected in output'));
            } catch (error) {
              logger.error({ agentId, error }, 'Error in onError callback');
            }
          }

          stopped = true;
          clearInterval(intervalId);
          return;
        }

        // Check for timeout
        if (options.timeout && Date.now() - startTime >= options.timeout) {
          logger.warn({ agentId, timeout: options.timeout }, 'Monitoring timeout reached');

          if (options.onError) {
            try {
              options.onError(new Error('Monitoring timeout'));
            } catch (error) {
              logger.error({ agentId, error }, 'Error in onError callback');
            }
          }

          stopped = true;
          clearInterval(intervalId);
          return;
        }
      } catch (error) {
        logger.error({ agentId, error }, 'Error during monitoring poll');

        if (options.onError) {
          try {
            options.onError(error as Error);
          } catch (callbackError) {
            logger.error({ agentId, error: callbackError }, 'Error in onError callback');
          }
        }

        stopped = true;
        clearInterval(intervalId);
      }
    };

    // Start polling
    intervalId = setInterval(poll, pollInterval);

    // Do initial poll
    poll();

    return {
      stop: () => {
        logger.info({ agentId }, 'Stopping agent monitoring');
        stopped = true;
        clearInterval(intervalId);
      },
    };
  }

  /**
   * Detect completion markers in output
   */
  private detectCompletion(output: string): boolean {
    return COMPLETION_MARKERS.some(pattern => pattern.test(output));
  }

  /**
   * Detect error markers in output
   */
  private detectError(output: string): boolean {
    return ERROR_MARKERS.some(pattern => pattern.test(output));
  }
}
