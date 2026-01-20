/**
 * Tmux control helpers
 */

import type { TmuxSession } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('tmux-utils');

export class TmuxError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'TmuxError';
  }
}

/**
 * Execute a tmux command
 */
async function execTmux(args: string[]): Promise<string> {
  const proc = Bun.spawn(['tmux', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = await new Response(proc.stdout).text();
  const errorOutput = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new TmuxError(
      `Tmux command failed: ${args.join(' ')}`,
      args.join(' '),
      exitCode,
      errorOutput
    );
  }

  return output.trim();
}

/**
 * Create a new tmux session
 */
export async function createSession(
  sessionName: string,
  command?: string
): Promise<TmuxSession> {
  logger.info({ sessionName, command }, 'Creating tmux session');

  try {
    // Create detached session
    const args = [
      'new-session',
      '-d', // detached
      '-s', sessionName,
    ];

    if (command) {
      args.push(command);
    }

    await execTmux(args);

    // Get session details
    const sessionInfo = await execTmux([
      'list-sessions',
      '-F', '#{session_name}:#{window_id}:#{pane_id}:#{pane_pid}',
      '-f', `#{==:#{session_name},${sessionName}}`,
    ]);

    const [name, windowId, paneId, pidStr] = sessionInfo.split(':');

    if (!name || !windowId || !paneId || !pidStr) {
      throw new TmuxError(
        'Failed to parse session info',
        'list-sessions',
        undefined,
        sessionInfo
      );
    }

    const session: TmuxSession = {
      name: sessionName,
      agentId: sessionName,
      windowId,
      paneId,
      pid: parseInt(pidStr, 10),
      createdAt: new Date(),
    };

    logger.info({ session }, 'Tmux session created successfully');
    return session;
  } catch (error) {
    logger.error({ sessionName, error }, 'Failed to create tmux session');
    throw error;
  }
}

/**
 * Destroy a tmux session
 */
export async function destroySession(sessionName: string): Promise<void> {
  logger.info({ sessionName }, 'Destroying tmux session');

  try {
    await execTmux(['kill-session', '-t', sessionName]);
    logger.info({ sessionName }, 'Tmux session destroyed successfully');
  } catch (error) {
    if (error instanceof TmuxError && error.stderr?.includes("can't find session")) {
      logger.warn({ sessionName }, 'Session does not exist, ignoring');
      return;
    }
    logger.error({ sessionName, error }, 'Failed to destroy tmux session');
    throw error;
  }
}

/**
 * Send keys to a tmux session
 */
export async function sendKeys(
  sessionName: string,
  keys: string
): Promise<void> {
  logger.debug({ sessionName, keys }, 'Sending keys to tmux session');

  try {
    await execTmux([
      'send-keys',
      '-t', sessionName,
      keys,
      'Enter',
    ]);
    logger.debug({ sessionName }, 'Keys sent successfully');
  } catch (error) {
    logger.error({ sessionName, error }, 'Failed to send keys');
    throw error;
  }
}

/**
 * Capture pane content from a tmux session
 */
export async function capturePane(sessionName: string): Promise<string> {
  logger.debug({ sessionName }, 'Capturing pane content');

  try {
    const output = await execTmux([
      'capture-pane',
      '-t', sessionName,
      '-p', // print to stdout
      '-J', // join wrapped lines
      '-S', '-', // start from beginning of history
    ]);
    logger.debug({ sessionName, lines: output.split('\n').length }, 'Pane captured');
    return output;
  } catch (error) {
    logger.error({ sessionName, error }, 'Failed to capture pane');
    throw error;
  }
}

/**
 * List all tmux sessions matching a pattern
 */
export async function listSessions(pattern?: string): Promise<string[]> {
  logger.debug({ pattern }, 'Listing tmux sessions');

  try {
    const output = await execTmux([
      'list-sessions',
      '-F', '#{session_name}',
    ]);

    const sessions = output.split('\n').filter(Boolean);

    if (pattern) {
      const regex = new RegExp(pattern);
      const filtered = sessions.filter(s => regex.test(s));
      logger.debug({ pattern, count: filtered.length }, 'Sessions filtered');
      return filtered;
    }

    logger.debug({ count: sessions.length }, 'Sessions listed');
    return sessions;
  } catch (error) {
    if (error instanceof TmuxError && error.stderr?.includes('no server running')) {
      logger.debug('No tmux server running, returning empty list');
      return [];
    }
    logger.error({ error }, 'Failed to list sessions');
    throw error;
  }
}

/**
 * Kill all sessions matching a pattern
 */
export async function killSessions(pattern: string): Promise<void> {
  logger.info({ pattern }, 'Killing sessions matching pattern');

  try {
    const sessions = await listSessions(pattern);

    if (sessions.length === 0) {
      logger.info({ pattern }, 'No sessions match pattern');
      return;
    }

    await Promise.all(sessions.map(session => destroySession(session)));

    logger.info({ pattern, count: sessions.length }, 'Sessions killed successfully');
  } catch (error) {
    logger.error({ pattern, error }, 'Failed to kill sessions');
    throw error;
  }
}

/**
 * Check if a session exists
 */
export async function sessionExists(sessionName: string): Promise<boolean> {
  logger.debug({ sessionName }, 'Checking if session exists');

  try {
    await execTmux(['has-session', '-t', sessionName]);
    logger.debug({ sessionName }, 'Session exists');
    return true;
  } catch (error) {
    if (error instanceof TmuxError) {
      logger.debug({ sessionName }, 'Session does not exist');
      return false;
    }
    logger.error({ sessionName, error }, 'Failed to check session existence');
    throw error;
  }
}
