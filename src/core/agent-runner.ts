/**
 * Agent instruction handling and output monitoring
 */

import type {
  AgentOutput,
  AgentMonitorOptions,
  SessionName,
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
  async sendInstruction(sessionName: SessionName, instruction: string): Promise<void> {
    logger.info({ sessionName, instructionLength: instruction.length }, 'Sending instruction to session');

    try {
      // Send instruction via tmux
      await sendKeys(sessionName, instruction);

      logger.info({ sessionName }, 'Instruction sent successfully');
    } catch (error) {
      logger.error({ sessionName, error }, 'Failed to send instruction');

      throw new AgentRunnerError(
        `Failed to send instruction to session ${sessionName}`,
        sessionName,
        { originalError: error }
      );
    }
  }

  /**
   * Capture current output from an agent
   */
  async captureOutput(sessionName: SessionName): Promise<AgentOutput> {
    logger.debug({ sessionName }, 'Capturing session output');

    try {
      const content = await capturePane(sessionName);

      // Analyze output for completion and errors
      const isComplete = this.detectCompletion(content);
      const hasError = this.detectError(content);

      const output: AgentOutput = {
        agentId: sessionName as unknown as import('../types/agent.types.js').AgentId,  // Temporary - will fix in agent tracking
        sessionName,
        content,
        timestamp: new Date(),
        isComplete,
        hasError,
      };

      logger.debug(
        { sessionName, lines: content.split('\n').length, isComplete, hasError },
        'Output captured and analyzed'
      );

      return output;
    } catch (error) {
      logger.error({ sessionName, error }, 'Failed to capture output');

      throw new AgentRunnerError(
        `Failed to capture output from session ${sessionName}`,
        sessionName,
        { originalError: error }
      );
    }
  }

  /**
   * Wait for agent to complete a task
   */
  async waitForCompletion(sessionName: SessionName, timeout: number): Promise<boolean> {
    logger.info({ sessionName, timeout }, 'Waiting for session completion');

    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    try {
      while (Date.now() - startTime < timeout) {
        const output = await this.captureOutput(sessionName);

        if (output.hasError) {
          logger.warn({ sessionName }, 'Error detected in session output');
          return false;
        }

        if (output.isComplete) {
          logger.info({ sessionName }, 'Session completed successfully');
          return true;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      logger.warn({ sessionName, timeout }, 'Timeout waiting for session completion');
      return false;
    } catch (error) {
      logger.error({ sessionName, error }, 'Error while waiting for completion');

      throw new AgentRunnerError(
        `Error while waiting for session ${sessionName} to complete`,
        sessionName,
        { originalError: error }
      );
    }
  }

  /**
   * Monitor an agent with periodic callbacks
   */
  monitorAgent(
    sessionName: SessionName,
    options: AgentMonitorOptions
  ): { stop: () => void } {
    logger.info({ sessionName, options }, 'Starting session monitoring');

    const pollInterval = options.pollInterval ?? 1000;
    const startTime = Date.now();

    let stopped = false;
    let intervalId: Timer;

    const poll = async () => {
      if (stopped) {
        return;
      }

      try {
        const output = await this.captureOutput(sessionName);

        // Call output callback if provided
        if (options.onOutput) {
          try {
            options.onOutput(output);
          } catch (error) {
            logger.error({ sessionName, error }, 'Error in onOutput callback');
          }
        }

        // Check for completion
        if (output.isComplete) {
          logger.info({ sessionName }, 'Session completed during monitoring');

          if (options.onComplete) {
            try {
              options.onComplete();
            } catch (error) {
              logger.error({ sessionName, error }, 'Error in onComplete callback');
            }
          }

          stopped = true;
          clearInterval(intervalId);
          return;
        }

        // Check for errors
        if (output.hasError) {
          logger.warn({ sessionName }, 'Error detected during monitoring');

          if (options.onError) {
            try {
              options.onError(new Error('Agent error detected in output'));
            } catch (error) {
              logger.error({ sessionName, error }, 'Error in onError callback');
            }
          }

          stopped = true;
          clearInterval(intervalId);
          return;
        }

        // Check for timeout
        if (options.timeout && Date.now() - startTime >= options.timeout) {
          logger.warn({ sessionName, timeout: options.timeout }, 'Monitoring timeout reached');

          if (options.onError) {
            try {
              options.onError(new Error('Monitoring timeout'));
            } catch (error) {
              logger.error({ sessionName, error }, 'Error in onError callback');
            }
          }

          stopped = true;
          clearInterval(intervalId);
          return;
        }
      } catch (error) {
        logger.error({ sessionName, error }, 'Error during monitoring poll');

        if (options.onError) {
          try {
            options.onError(error as Error);
          } catch (callbackError) {
            logger.error({ sessionName, error: callbackError }, 'Error in onError callback');
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
        logger.info({ sessionName }, 'Stopping session monitoring');
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
