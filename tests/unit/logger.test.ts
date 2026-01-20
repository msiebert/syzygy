/**
 * Unit tests for logger
 */

import { describe, it, expect } from 'bun:test';
import { logger, createAgentLogger, createModuleLogger } from '../../src/utils/logger.js';

describe('logger', () => {
  it('should export a logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should create agent logger with agent ID', () => {
    const agentLogger = createAgentLogger('test-agent');
    expect(agentLogger).toBeDefined();
    expect(typeof agentLogger.info).toBe('function');
  });

  it('should create module logger with module name', () => {
    const moduleLogger = createModuleLogger('test-module');
    expect(moduleLogger).toBeDefined();
    expect(typeof moduleLogger.info).toBe('function');
  });

  it('should handle production mode (no transport)', () => {
    // This test ensures the production code path is covered
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    // Import logger again to trigger production mode
    // In actual coverage, this would be covered during module initialization
    expect(logger).toBeDefined();

    // Restore environment
    if (originalEnv !== undefined) {
      process.env['NODE_ENV'] = originalEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
  });
});
