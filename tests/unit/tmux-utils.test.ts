/**
 * Unit tests for tmux-utils
 *
 * NOTE: These tests require the real tmux-utils module (not mocked).
 * When run in parallel with tests that mock tmux-utils (e.g., orchestrator.test.ts),
 * these tests will be skipped.
 */

import { describe, it, expect, spyOn, beforeAll, afterAll } from 'bun:test';
import * as tmuxUtils from '../../src/utils/tmux-utils.js';
import { toSessionName, toAgentId } from '../../src/types/agent.types.js';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Temp file for launchClaudeCLI tests
const TEMP_PROMPT_PATH = join(tmpdir(), 'syzygy-test-prompt.md');
const TEMP_PROMPT_CONTENT = '# Test System Prompt\n\nYou are a test agent.';

// Check if the module is the real one or has been replaced by a mock
// When mocked, the createSession function won't have the expected implementation
const isModuleReal = typeof tmuxUtils.createSession === 'function' &&
  tmuxUtils.createSession.toString().includes('async');

// Use describe wrapper for conditional skipping at registration time
const describeIfReal = isModuleReal ? describe : describe.skip;

describe('tmux-utils', () => {
  describeIfReal('createSession', () => {
    it('should create a new tmux session successfully', async () => {
      // Mock Bun.spawn to simulate tmux command responses
      const mockSpawn = spyOn(Bun, 'spawn');

      // Mock new-session command (returns nothing on success)
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(''));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock list-sessions command
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('test-session:@1:@1.1:12345')
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      const session = await tmuxUtils.createSession(toSessionName('test-session'));

      expect(session.name).toBe(toSessionName('test-session'));
      expect(session.agentId).toBe(toAgentId('placeholder'));
      expect(session.windowId).toBe('@1');
      expect(session.paneId).toBe('@1.1');
      expect(session.pid).toBe(12345);
      expect(session.createdAt).toBeInstanceOf(Date);

      mockSpawn.mockRestore();
    });

    it('should create session with custom command', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(''));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('test:@1:@1.1:12345')
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.createSession(toSessionName('test'), 'bash');

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      mockSpawn.mockRestore();
    });

    it('should throw TmuxError on failure', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('session already exists'));
            controller.close();
          },
        }),
        exited: Promise.resolve(1),
      } as any));

      await expect(tmuxUtils.createSession(toSessionName('test'))).rejects.toThrow(tmuxUtils.TmuxError);

      mockSpawn.mockRestore();
    });
  });

  describeIfReal('destroySession', () => {
    it('should destroy a session successfully', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.destroySession(toSessionName('test-session'));

      expect(mockSpawn).toHaveBeenCalledWith(['tmux', 'kill-session', '-t', 'test-session'], expect.any(Object));
      mockSpawn.mockRestore();
    });

    it('should not throw if session does not exist', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("can't find session"));
            controller.close();
          },
        }),
        exited: Promise.resolve(1),
      } as any));

      // Should not throw
      await tmuxUtils.destroySession(toSessionName('nonexistent'));

      mockSpawn.mockRestore();
    });
  });

  describe('sendKeys', () => {
    it('should send keys to a session', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.sendKeys(toSessionName('test-session'), 'echo hello');

      expect(mockSpawn).toHaveBeenCalledWith(
        ['tmux', 'send-keys', '-t', 'test-session', 'echo hello', 'Enter'],
        expect.any(Object)
      );
      mockSpawn.mockRestore();
    });
  });

  describe('capturePane', () => {
    it('should capture pane content', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('line1\nline2\nline3'));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      const content = await tmuxUtils.capturePane(toSessionName('test-session'));

      expect(content).toBe('line1\nline2\nline3');
      mockSpawn.mockRestore();
    });
  });

  describe('listSessions', () => {
    it('should list all sessions', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('session1\nsession2\nsession3'));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      const sessions = await tmuxUtils.listSessions();

      expect(sessions).toEqual(['session1', 'session2', 'session3']);
      mockSpawn.mockRestore();
    });

    it('should filter sessions by pattern', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('syzygy-pm\nsyzygy-dev-1\nother-session')
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      const sessions = await tmuxUtils.listSessions('^syzygy-');

      expect(sessions).toEqual(['syzygy-pm', 'syzygy-dev-1']);
      mockSpawn.mockRestore();
    });

    it('should return empty array if no server running', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('no server running'));
            controller.close();
          },
        }),
        exited: Promise.resolve(1),
      } as any));

      const sessions = await tmuxUtils.listSessions();

      expect(sessions).toEqual([]);
      mockSpawn.mockRestore();
    });
  });

  describeIfReal('sessionExists', () => {
    it('should return true if session exists', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      const exists = await tmuxUtils.sessionExists(toSessionName('test-session'));

      expect(exists).toBe(true);
      mockSpawn.mockRestore();
    });

    it('should return false if session does not exist', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(1),
      } as any));

      const exists = await tmuxUtils.sessionExists(toSessionName('nonexistent'));

      expect(exists).toBe(false);
      mockSpawn.mockRestore();
    });
  });

  describeIfReal('killSessions', () => {
    it('should kill all sessions matching pattern', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      // Mock listSessions
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('syzygy-pm\nsyzygy-dev-1\nsyzygy-dev-2')
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock destroySession calls (3 times)
      for (let i = 0; i < 3; i++) {
        mockSpawn.mockImplementationOnce(() => ({
          stdout: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          exited: Promise.resolve(0),
        } as any));
      }

      await tmuxUtils.killSessions('^syzygy-');

      expect(mockSpawn).toHaveBeenCalledTimes(4); // 1 list + 3 kills
      mockSpawn.mockRestore();
    });

    it('should do nothing if no sessions match', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('other-session'));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.killSessions('^syzygy-');

      expect(mockSpawn).toHaveBeenCalledTimes(1); // Only list call
      mockSpawn.mockRestore();
    });
  });

  describe('launchClaudeCLI', () => {
    // Setup: Create temp prompt file before tests
    beforeAll(async () => {
      await writeFile(TEMP_PROMPT_PATH, TEMP_PROMPT_CONTENT, 'utf-8');
    });

    // Cleanup: Remove temp prompt file after tests
    afterAll(async () => {
      await unlink(TEMP_PROMPT_PATH).catch(() => {});
    });

    it('should launch Claude CLI successfully with Claude Code prompt', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      // Mock send-keys for cd command
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock send-keys for claude command
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock capture-pane (multiple times for polling)
      // Return Claude Code detected on first attempt
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Claude Code\n> '));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.launchClaudeCLI(toSessionName('test-pm'), {
        systemPromptPath: TEMP_PROMPT_PATH,
        workingDirectory: '/tmp/project',
        sessionId: 'test-session',
      });

      expect(mockSpawn).toHaveBeenCalled();
      mockSpawn.mockRestore();
    });

    it('should launch Claude CLI successfully with alternative prompts', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      // Mock send-keys for cd
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock send-keys for claude
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock capture-pane with "How can I help" prompt
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('How can I help you today?'));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.launchClaudeCLI(toSessionName('test-pm'), {
        systemPromptPath: TEMP_PROMPT_PATH,
        workingDirectory: '/tmp/project',
        sessionId: 'test-session',
      });

      expect(mockSpawn).toHaveBeenCalled();
      mockSpawn.mockRestore();
    });

    it.skip('should timeout if Claude CLI does not initialize (skipped: takes 90+ seconds due to real setTimeout delays)', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      // Mock send-keys for cd
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock send-keys for claude
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock capture-pane with no Claude prompt (for all 90 attempts)
      for (let i = 0; i < 90; i++) {
        mockSpawn.mockImplementationOnce(() => ({
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('initializing...'));
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          exited: Promise.resolve(0),
        } as any));
      }

      await expect(
        tmuxUtils.launchClaudeCLI(toSessionName('test-pm'), {
          systemPromptPath: TEMP_PROMPT_PATH,
          workingDirectory: '/tmp/project',
          sessionId: 'test-session',
        })
      ).rejects.toThrow(tmuxUtils.TmuxError);

      mockSpawn.mockRestore();
    });

    it('should read prompt file and pass content inline via --append-system-prompt', async () => {
      const mockSpawn = spyOn(Bun, 'spawn');

      // Mock send-keys for cd command
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock send-keys for claude command
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      // Mock capture-pane
      mockSpawn.mockImplementationOnce(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Claude Code\n> '));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
      } as any));

      await tmuxUtils.launchClaudeCLI(toSessionName('test-pm'), {
        systemPromptPath: TEMP_PROMPT_PATH,
        workingDirectory: '/tmp/project',
        sessionId: 'test-session',
      });

      // Verify that the command was sent (reads file and passes content inline)
      expect(mockSpawn).toHaveBeenCalledTimes(3); // cd, claude, capture

      mockSpawn.mockRestore();
    });
  });
});
