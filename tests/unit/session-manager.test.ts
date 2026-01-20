/**
 * Unit tests for SessionManager
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SessionManager } from '@core/session-manager';
import { SessionError } from '../../src/types/message.types';
import type { Agent } from '../../src/types/agent.types';
import type { TmuxSession } from '../../src/types/message.types';

// Mock tmux-utils
const mockCreateSession = mock(async (sessionName: string): Promise<TmuxSession> => {
  return {
    name: sessionName,
    agentId: sessionName,
    windowId: '@0',
    paneId: '%0',
    pid: 12345,
    createdAt: new Date(),
  };
});

const mockDestroySession = mock(async (_sessionName: string): Promise<void> => {
  return;
});

const mockSessionExists = mock(async (_sessionName: string): Promise<boolean> => {
  return false;
});

// Mock the module
mock.module('@utils/tmux-utils', () => ({
  createSession: mockCreateSession,
  destroySession: mockDestroySession,
  sessionExists: mockSessionExists,
}));

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let testAgent: Agent;

  beforeEach(() => {
    sessionManager = new SessionManager();
    testAgent = {
      id: 'test-agent-1',
      role: 'developer',
      sessionName: 'syzygy-dev-1',
      status: 'idle',
    };

    // Reset mocks
    mockCreateSession.mockClear();
    mockDestroySession.mockClear();
    mockSessionExists.mockClear();
  });

  describe('createAgentSession', () => {
    it('should create a new agent session successfully', async () => {
      const session = await sessionManager.createAgentSession(testAgent);

      expect(session).toBeDefined();
      expect(session.agentId).toBe(testAgent.id);
      expect(session.name).toBe(testAgent.sessionName);
      expect(mockCreateSession).toHaveBeenCalledWith(testAgent.sessionName);
    });

    it('should store session in internal map', async () => {
      await sessionManager.createAgentSession(testAgent);

      const storedSession = sessionManager.getSession(testAgent.id);
      expect(storedSession).toBeDefined();
      expect(storedSession?.agentId).toBe(testAgent.id);
    });

    it('should throw SessionError if session already exists', async () => {
      await sessionManager.createAgentSession(testAgent);

      await expect(
        sessionManager.createAgentSession(testAgent)
      ).rejects.toThrow(SessionError);
    });

    it('should wrap tmux errors in SessionError', async () => {
      mockCreateSession.mockImplementationOnce(async () => {
        throw new Error('Tmux failed');
      });

      await expect(
        sessionManager.createAgentSession(testAgent)
      ).rejects.toThrow(SessionError);
    });

    it('should include agent ID in error context', async () => {
      mockCreateSession.mockImplementationOnce(async () => {
        throw new Error('Tmux failed');
      });

      try {
        await sessionManager.createAgentSession(testAgent);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).agentId).toBe(testAgent.id);
      }
    });
  });

  describe('destroyAgentSession', () => {
    beforeEach(async () => {
      await sessionManager.createAgentSession(testAgent);
      mockDestroySession.mockClear();
    });

    it('should destroy an existing session', async () => {
      await sessionManager.destroyAgentSession(testAgent.id);

      expect(mockDestroySession).toHaveBeenCalledWith(testAgent.sessionName);
    });

    it('should remove session from internal map', async () => {
      await sessionManager.destroyAgentSession(testAgent.id);

      const session = sessionManager.getSession(testAgent.id);
      expect(session).toBeUndefined();
    });

    it('should handle non-existent session gracefully', async () => {
      await sessionManager.destroyAgentSession('non-existent-agent');

      expect(mockSessionExists).toHaveBeenCalledWith('non-existent-agent');
    });

    it('should destroy orphaned tmux session if found', async () => {
      mockSessionExists.mockResolvedValueOnce(true);

      await sessionManager.destroyAgentSession('orphaned-agent');

      expect(mockDestroySession).toHaveBeenCalledWith('orphaned-agent');
    });

    it('should remove from map even if tmux destroy fails', async () => {
      mockDestroySession.mockRejectedValueOnce(new Error('Tmux error'));

      await expect(
        sessionManager.destroyAgentSession(testAgent.id)
      ).rejects.toThrow(SessionError);

      const session = sessionManager.getSession(testAgent.id);
      expect(session).toBeUndefined();
    });
  });

  describe('getSession', () => {
    it('should return session for existing agent', async () => {
      await sessionManager.createAgentSession(testAgent);

      const session = sessionManager.getSession(testAgent.id);
      expect(session).toBeDefined();
      expect(session?.agentId).toBe(testAgent.id);
    });

    it('should return undefined for non-existent agent', () => {
      const session = sessionManager.getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('getAllSessions', () => {
    it('should return empty array when no sessions exist', () => {
      const sessions = sessionManager.getAllSessions();
      expect(sessions).toEqual([]);
    });

    it('should return all active sessions', async () => {
      const agent1 = { ...testAgent, id: 'agent-1', sessionName: 'session-1' };
      const agent2 = { ...testAgent, id: 'agent-2', sessionName: 'session-2' };

      await sessionManager.createAgentSession(agent1);
      await sessionManager.createAgentSession(agent2);

      const sessions = sessionManager.getAllSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.agentId)).toContain('agent-1');
      expect(sessions.map(s => s.agentId)).toContain('agent-2');
    });
  });

  describe('cleanupAllSessions', () => {
    it('should cleanup all sessions in parallel', async () => {
      const agent1 = { ...testAgent, id: 'agent-1', sessionName: 'session-1' };
      const agent2 = { ...testAgent, id: 'agent-2', sessionName: 'session-2' };

      await sessionManager.createAgentSession(agent1);
      await sessionManager.createAgentSession(agent2);

      mockDestroySession.mockClear();
      await sessionManager.cleanupAllSessions();

      expect(mockDestroySession).toHaveBeenCalledTimes(2);
      expect(sessionManager.getAllSessions()).toHaveLength(0);
    });

    it('should handle empty session list gracefully', async () => {
      await sessionManager.cleanupAllSessions();

      expect(mockDestroySession).not.toHaveBeenCalled();
    });

    it('should continue cleanup even if one session fails', async () => {
      const agent1 = { ...testAgent, id: 'agent-1', sessionName: 'session-1' };
      const agent2 = { ...testAgent, id: 'agent-2', sessionName: 'session-2' };

      await sessionManager.createAgentSession(agent1);
      await sessionManager.createAgentSession(agent2);

      // Make first destroy fail
      mockDestroySession.mockRejectedValueOnce(new Error('First failed'));

      await sessionManager.cleanupAllSessions();

      // Both should have been attempted
      expect(mockDestroySession).toHaveBeenCalledTimes(2);
    });
  });
});
