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
