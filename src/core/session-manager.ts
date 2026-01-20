/**
 * Tmux session lifecycle management
 */

import type { Agent } from '../types/agent.types.js';
import type { TmuxSession } from '../types/message.types.js';
import { SessionError } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';
import { createSession, destroySession, sessionExists } from '@utils/tmux-utils';

const logger = createModuleLogger('session-manager');

export class SessionManager {
  private sessions: Map<string, TmuxSession> = new Map();

  /**
   * Create a new agent session
   */
  async createAgentSession(agent: Agent): Promise<TmuxSession> {
    logger.info({ agentId: agent.id, role: agent.role }, 'Creating agent session');

    try {
      // Check if session already exists
      if (this.sessions.has(agent.id)) {
        throw new SessionError(
          'Session already exists for this agent',
          agent.id,
          { sessionName: agent.sessionName }
        );
      }

      // Create tmux session
      const session = await createSession(agent.sessionName);

      // Store session metadata with agent ID
      const agentSession: TmuxSession = {
        ...session,
        agentId: agent.id,
      };

      this.sessions.set(agent.id, agentSession);

      logger.info(
        { agentId: agent.id, sessionName: agent.sessionName },
        'Agent session created successfully'
      );

      return agentSession;
    } catch (error) {
      logger.error(
        { agentId: agent.id, error },
        'Failed to create agent session'
      );

      if (error instanceof SessionError) {
        throw error;
      }

      throw new SessionError(
        `Failed to create session for agent ${agent.id}`,
        agent.id,
        { originalError: error }
      );
    }
  }

  /**
   * Destroy an agent session
   */
  async destroyAgentSession(agentId: string): Promise<void> {
    logger.info({ agentId }, 'Destroying agent session');

    try {
      const session = this.sessions.get(agentId);

      if (!session) {
        logger.warn({ agentId }, 'Session not found in map, checking tmux');

        // Try to destroy anyway in case it exists in tmux but not in map
        const exists = await sessionExists(agentId);
        if (exists) {
          await destroySession(agentId);
          logger.info({ agentId }, 'Orphaned session destroyed');
        }

        return;
      }

      // Destroy tmux session
      await destroySession(session.name);

      // Remove from map
      this.sessions.delete(agentId);

      logger.info({ agentId }, 'Agent session destroyed successfully');
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to destroy agent session');

      // Still remove from map even if tmux destroy failed
      this.sessions.delete(agentId);

      throw new SessionError(
        `Failed to destroy session for agent ${agentId}`,
        agentId,
        { originalError: error }
      );
    }
  }

  /**
   * Get session by agent ID
   */
  getSession(agentId: string): TmuxSession | undefined {
    return this.sessions.get(agentId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): TmuxSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Cleanup all sessions
   */
  async cleanupAllSessions(): Promise<void> {
    logger.info({ count: this.sessions.size }, 'Cleaning up all sessions');

    try {
      const agentIds = Array.from(this.sessions.keys());

      if (agentIds.length === 0) {
        logger.info('No sessions to clean up');
        return;
      }

      // Destroy all sessions in parallel
      await Promise.allSettled(
        agentIds.map(agentId => this.destroyAgentSession(agentId))
      );

      logger.info({ count: agentIds.length }, 'All sessions cleaned up');
    } catch (error) {
      logger.error({ error }, 'Error during session cleanup');
      throw new SessionError(
        'Failed to cleanup all sessions',
        'cleanup',
        { originalError: error }
      );
    }
  }
}
