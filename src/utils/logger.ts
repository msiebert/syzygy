/**
 * Structured logging with Pino
 */

import pino from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';

const loggerOptions = isDevelopment
  ? {
      level: process.env['LOG_LEVEL'] || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss',
        },
      },
    }
  : {
      level: process.env['LOG_LEVEL'] || 'info',
    };

export const logger: pino.Logger = pino(loggerOptions);

/**
 * Create a child logger for a specific agent
 */
export function createAgentLogger(agentId: string): pino.Logger {
  return logger.child({ agentId });
}

/**
 * Create a child logger for a specific module
 */
export function createModuleLogger(module: string): pino.Logger {
  return logger.child({ module });
}

// Saved log level for pause/resume
let savedLogLevel: string = 'info';

/**
 * Pause logging (set level to silent)
 * Use during Ink rendering to prevent display corruption
 */
export function pauseLogging(): void {
  savedLogLevel = logger.level;
  logger.level = 'silent';
}

/**
 * Resume logging (restore previous level)
 * Call after Ink rendering stops
 */
export function resumeLogging(): void {
  logger.level = savedLogLevel;
}
