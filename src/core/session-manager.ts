/**
 * Tmux session lifecycle management
 */

import type { Agent } from '../types/agent.types.js';
import type { TmuxSession } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('session-manager');

export class SessionManager {
  private sessions: Map<string, TmuxSession> = new Map();

  /**
   * Create a new agent session
   */
  async createAgentSession(agent: Agent): Promise<TmuxSession> {
    logger.info({ agentId: agent.id }, 'Creating agent session');
    // TODO: Implement session creation
    throw new Error('Not implemented');
  }

  /**
   * Destroy an agent session
   */
  async destroyAgentSession(agentId: string): Promise<void> {
    logger.info({ agentId }, 'Destroying agent session');
    // TODO: Implement session destruction
    throw new Error('Not implemented');
  }

  /**
   * Get session by agent ID
   */
  getSession(agentId: string): TmuxSession | undefined {
    return this.sessions.get(agentId);
  }

  /**
   * Cleanup all sessions
   */
  async cleanupAllSessions(): Promise<void> {
    logger.info('Cleaning up all sessions');
    // TODO: Implement cleanup
    throw new Error('Not implemented');
  }
}
