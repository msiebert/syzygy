/**
 * Tmux control helpers
 */

import type { TmuxSession } from '../types/message.types.js';
import type { SessionName } from '../types/agent.types.js';
import { toAgentId, toSessionName } from '../types/agent.types.js';
import { createModuleLogger } from '@utils/logger';
import { escapeShellArg } from '@utils/sanitize';

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
  sessionName: SessionName,
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
      agentId: toAgentId('placeholder'), // Will be overridden by session-manager
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
export async function destroySession(sessionName: SessionName): Promise<void> {
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
  sessionName: SessionName,
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
export async function capturePane(sessionName: SessionName): Promise<string> {
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

    await Promise.all(sessions.map(session => destroySession(toSessionName(session))));

    logger.info({ pattern, count: sessions.length }, 'Sessions killed successfully');
  } catch (error) {
    logger.error({ pattern, error }, 'Failed to kill sessions');
    throw error;
  }
}

/**
 * Check if a session exists
 */
export async function sessionExists(sessionName: SessionName): Promise<boolean> {
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

/**
 * Send raw keys to tmux session without automatic Enter
 */
export async function sendKeysRaw(
  sessionName: SessionName,
  keys: string
): Promise<void> {
  logger.debug({ sessionName, keys }, 'Sending raw keys to tmux session');

  try {
    await execTmux([
      'send-keys',
      '-t', sessionName,
      '-l', // literal flag - send exact characters
      keys,
    ]);
    logger.debug({ sessionName }, 'Raw keys sent successfully');
  } catch (error) {
    logger.error({ sessionName, error }, 'Failed to send raw keys');
    throw error;
  }
}

/**
 * Send special key to tmux session
 */
export async function sendSpecialKey(
  sessionName: SessionName,
  key: 'Enter' | 'BSpace' | 'C-c' | 'Escape'
): Promise<void> {
  logger.debug({ sessionName, key }, 'Sending special key to tmux session');

  try {
    await execTmux([
      'send-keys',
      '-t', sessionName,
      key,
    ]);
    logger.debug({ sessionName, key }, 'Special key sent successfully');
  } catch (error) {
    logger.error({ sessionName, key, error }, 'Failed to send special key');
    throw error;
  }
}

/**
 * Options for async Claude CLI initialization
 */
export interface ClaudeCLIInitOptions {
  systemPromptPath: string;
  workingDirectory: string;
  sessionId: string;
  onProgress?: (elapsedSeconds: number) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Result of async Claude CLI launch
 */
export interface ClaudeCLIInitResult {
  waitForReady: () => Promise<void>;
  abort: () => void;
}

/**
 * Check if Claude CLI output indicates it's ready
 */
function isClaudeReady(output: string): boolean {
  return (
    output.includes('Claude Code') ||
    output.includes('How can I help') ||
    output.includes('claude>') ||
    output.includes('What would you like to work on?') ||
    /^>\s*$/m.test(output)
  );
}

/**
 * Launch Claude Code CLI asynchronously - returns immediately and polls in background
 */
export async function launchClaudeCLIAsync(
  sessionName: SessionName,
  options: ClaudeCLIInitOptions
): Promise<ClaudeCLIInitResult> {
  // Change to working directory (fast operation)
  await sendKeys(sessionName, `cd ${escapeShellArg(options.workingDirectory)}`);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Launch Claude CLI with system prompt
  const claudeCommand = `claude --system-prompt ${escapeShellArg(options.systemPromptPath)} --setting-sources project --session-id ${escapeShellArg(options.sessionId)}`;
  await sendKeys(sessionName, claudeCommand);

  // Return immediately, poll in background
  let aborted = false;
  const readyPromise = new Promise<void>((resolve, reject) => {
    // Background polling loop - doesn't block the caller
    (async () => {
      const maxAttempts = 90;
      for (let i = 0; i < maxAttempts && !aborted; i++) {
        await new Promise(r => setTimeout(r, 1000));
        options.onProgress?.(i + 1);

        try {
          const output = await capturePane(sessionName);
          if (isClaudeReady(output)) {
            options.onReady?.();
            resolve();
            return;
          }
        } catch {
          // Ignore capture errors during polling, continue trying
        }
      }

      if (!aborted) {
        const err = new TmuxError(
          'Claude CLI failed to initialize within timeout',
          claudeCommand,
          undefined,
          `Timeout after ${maxAttempts}s`
        );
        options.onError?.(err);
        reject(err);
      }
    })();
  });

  return {
    waitForReady: () => readyPromise,
    abort: () => {
      aborted = true;
    },
  };
}

/**
 * Launch Claude Code CLI in a tmux session (blocking version)
 */
export async function launchClaudeCLI(
  sessionName: SessionName,
  options: {
    systemPromptPath: string;
    workingDirectory: string;
    sessionId: string;
  }
): Promise<void> {
  logger.info({ sessionName, options }, 'Launching Claude Code CLI in tmux session');

  try {
    // Change to working directory
    await sendKeys(sessionName, `cd ${escapeShellArg(options.workingDirectory)}`);

    // Wait longer for cd to complete and verify
    await new Promise(resolve => setTimeout(resolve, 500));

    // Launch Claude CLI with system prompt (pass file path directly, not via command substitution)
    const claudeCommand = `claude --system-prompt ${escapeShellArg(options.systemPromptPath)} --setting-sources project --session-id ${escapeShellArg(options.sessionId)}`;
    await sendKeys(sessionName, claudeCommand);

    // Wait for Claude to initialize (poll for prompt)
    logger.debug({ sessionName }, 'Waiting for Claude CLI to initialize');
    const maxAttempts = 90; // Increased from 30 to 90 seconds
    let initialized = false;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await capturePane(sessionName);

      // Check for Claude prompt indicators (expanded patterns)
      if (
        output.includes('Claude Code') ||
        output.includes('How can I help') ||
        output.includes('claude>') ||
        output.includes('What would you like to work on?') ||
        output.match(/^>\s*$/m) // Claude's ready prompt
      ) {
        initialized = true;
        logger.info(
          { sessionName, attempt: i + 1, elapsedSeconds: i + 1 },
          'Claude CLI initialized successfully'
        );
        break;
      }

      // Log progress every 15 seconds
      if ((i + 1) % 15 === 0) {
        logger.info(
          { sessionName, elapsedSeconds: i + 1 },
          'Still waiting for Claude CLI to initialize...'
        );
      }
    }

    if (!initialized) {
      // Capture full diagnostic output
      const diagnosticOutput = await capturePane(sessionName);

      logger.error(
        {
          sessionName,
          timeout: maxAttempts,
          systemPromptPath: options.systemPromptPath,
          workingDirectory: options.workingDirectory,
          sessionId: options.sessionId,
          claudeCommand,
          paneOutput: diagnosticOutput,
        },
        'Claude CLI initialization timeout - full diagnostics'
      );

      throw new TmuxError(
        'Claude CLI failed to initialize within timeout',
        claudeCommand,
        undefined,
        `Timeout after ${maxAttempts}s. Last output: ${diagnosticOutput.slice(-500)}`
      );
    }
  } catch (error) {
    logger.error({ sessionName, error }, 'Failed to launch Claude CLI');
    throw error;
  }
}
