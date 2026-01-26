/**
 * Tmux session lifecycle management
 */

import type { Agent, AgentId } from '../types/agent.types.js';
import type { TmuxSession } from '../types/message.types.js';
import { SessionError } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';
import { createSession, destroySession, launchClaudeCLI } from '@utils/tmux-utils';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const logger = createModuleLogger('session-manager');

export class SessionManager {
  private sessions: Map<AgentId, TmuxSession> = new Map();

  /**
   * Create a new agent session
   */
  async createAgentSession(
    agent: Agent,
    options?: {
      launchClaude?: boolean;
      systemPrompt?: string;
      workingDirectory?: string;
      sessionId?: string;
    }
  ): Promise<TmuxSession> {
    logger.info({ agentId: agent.id, role: agent.role, options }, 'Creating agent session');

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

      // Launch Claude CLI if requested
      if (options?.launchClaude && options.systemPrompt) {
        logger.info({ agentId: agent.id }, 'Launching Claude CLI in session');

        // Validate prompt is not empty
        if (!options.systemPrompt || options.systemPrompt.trim().length === 0) {
          throw new SessionError(
            'System prompt cannot be empty',
            agent.id,
            { role: agent.role }
          );
        }

        // Write system prompt to file
        const promptPath = `.syzygy/stages/prompts/${agent.role}-prompt.md`;
        await mkdir(dirname(promptPath), { recursive: true });

        logger.debug(
          {
            agentId: agent.id,
            promptPath,
            promptLength: options.systemPrompt.length,
            promptPreview: options.systemPrompt.substring(0, 100),
          },
          'Writing system prompt file'
        );

        await writeFile(promptPath, options.systemPrompt, 'utf-8');

        // Verify file was written correctly
        const writtenContent = await readFile(promptPath, 'utf-8');
        if (writtenContent !== options.systemPrompt) {
          throw new SessionError(
            'Prompt file write verification failed',
            agent.id,
            {
              promptPath,
              expectedLength: options.systemPrompt.length,
              actualLength: writtenContent.length,
            }
          );
        }

        logger.debug({ agentId: agent.id, promptPath }, 'System prompt file written and verified');

        // Launch Claude CLI
        await launchClaudeCLI(agent.sessionName, {
          systemPromptPath: promptPath,
          workingDirectory: options.workingDirectory || process.cwd(),
          sessionId: options.sessionId || `syzygy-${agent.role}`,
        });

        logger.info({ agentId: agent.id }, 'Claude CLI launched successfully');
      }

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
  async destroyAgentSession(agentId: AgentId): Promise<void> {
    logger.info({ agentId }, 'Destroying agent session');

    try {
      const session = this.sessions.get(agentId);

      if (!session) {
        logger.warn({ agentId }, 'Session not found in map, cannot destroy');
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
  getSession(agentId: AgentId): TmuxSession | undefined {
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
