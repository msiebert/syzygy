/**
 * Tmux control helpers
 */

import type { TmuxSession } from '../types/message.types.js';
import type { SessionName } from '../types/agent.types.js';
import { toAgentId, toSessionName } from '../types/agent.types.js';
import { createModuleLogger } from '@utils/logger';
import { escapeShellArg } from '@utils/sanitize';
import { readFile } from 'node:fs/promises';

const logger = createModuleLogger('tmux-utils');

/**
 * Branded type for tmux pane IDs
 */
export type PaneId = string & { readonly __brand: 'PaneId' };

/**
 * Check if currently running inside tmux
 */
export function isInsideTmux(): boolean {
  return !!process.env['TMUX'];
}

/**
 * Get current tmux pane ID (when running inside tmux)
 */
export function getCurrentPane(): PaneId | null {
  const paneId = process.env['TMUX_PANE'];
  return paneId ? (paneId as PaneId) : null;
}

/**
 * Split current pane and run command in new pane
 * @param direction - 'horizontal' splits side-by-side, 'vertical' splits top-bottom
 * @param command - Command to run in the new pane
 * @param percentage - Percentage of space for new pane (default 50)
 * @returns The new pane ID
 */
export async function splitPaneWithCommand(
  direction: 'horizontal' | 'vertical',
  command: string,
  percentage = 50
): Promise<PaneId> {
  logger.info({ direction, command, percentage }, 'Splitting pane with command');

  const directionFlag = direction === 'horizontal' ? '-h' : '-v';

  try {
    // Split pane and get new pane ID
    // -P prints pane info, -F format string to get pane ID
    const output = await execTmux([
      'split-window',
      directionFlag,
      '-p', percentage.toString(),
      '-P',
      '-F', '#{pane_id}',
      command,
    ]);

    const paneId = output.trim() as PaneId;
    logger.info({ paneId, direction, command }, 'Pane split successfully');
    return paneId;
  } catch (error) {
    logger.error({ error, direction, command }, 'Failed to split pane');
    throw error;
  }
}

/**
 * Join a pane from another session into the current window
 * This moves the target session's pane into the current session's layout
 *
 * @param sourceSession - The session to take a pane from
 * @param direction - 'horizontal' splits side-by-side, 'vertical' splits top-bottom
 * @param percentage - Percentage of space for the joined pane (default 50)
 * @returns The new pane ID in the current session
 */
export async function joinPaneFromSession(
  sourceSession: SessionName,
  direction: 'horizontal' | 'vertical',
  percentage = 50
): Promise<PaneId> {
  logger.info({ sourceSession, direction, percentage }, 'Joining pane from session');

  const directionFlag = direction === 'horizontal' ? '-h' : '-v';

  try {
    // Join pane from source session (window 0, pane 0) into current window
    // Note: join-pane doesn't support -P flag like split-window does
    await execTmux([
      'join-pane',
      '-s', `${sourceSession}:0.0`,  // Source: first pane of first window
      directionFlag,
      '-p', percentage.toString(),
    ]);

    // Get the pane ID of the newly joined pane
    // After join-pane, the joined pane becomes the active pane
    const output = await execTmux([
      'display-message',
      '-p', '#{pane_id}',
    ]);

    const paneId = output.trim() as PaneId;
    logger.info({ paneId, sourceSession, direction }, 'Pane joined successfully');
    return paneId;
  } catch (error) {
    logger.error({ error, sourceSession, direction }, 'Failed to join pane');
    throw error;
  }
}

/**
 * Split current pane and attach to another session in the new pane
 * This is more reliable than join-pane for detached sessions
 *
 * @param targetSession - The session to attach to in the new pane
 * @param direction - 'horizontal' splits side-by-side, 'vertical' splits top-bottom
 * @param percentage - Percentage of space for the new pane (default 50)
 * @returns The new pane ID
 */
export async function splitAndAttachSession(
  targetSession: SessionName,
  direction: 'horizontal' | 'vertical',
  percentage = 50
): Promise<PaneId> {
  logger.info({ targetSession, direction, percentage }, 'Splitting pane and attaching session');

  const directionFlag = direction === 'horizontal' ? '-h' : '-v';

  try {
    const output = await execTmux([
      'split-window',
      directionFlag,
      '-p', percentage.toString(),
      '-P',
      '-F', '#{pane_id}',
      `tmux attach -t ${targetSession}`,
    ]);

    const paneId = output.trim() as PaneId;
    logger.info({ paneId, targetSession, direction }, 'Pane split and attached successfully');
    return paneId;
  } catch (error) {
    logger.error({ error, targetSession, direction }, 'Failed to split and attach');
    throw error;
  }
}

/**
 * Close a specific pane by ID
 */
export async function closePane(paneId: PaneId): Promise<void> {
  logger.info({ paneId }, 'Closing pane');

  try {
    await execTmux(['kill-pane', '-t', paneId]);
    logger.info({ paneId }, 'Pane closed successfully');
  } catch (error) {
    if (error instanceof TmuxError && error.stderr?.includes("can't find pane")) {
      logger.warn({ paneId }, 'Pane does not exist, ignoring');
      return;
    }
    logger.error({ paneId, error }, 'Failed to close pane');
    throw error;
  }
}

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
      '-S', '-50', // last 50 lines only (prevents capturing redraw history)
    ]);
    logger.debug({ sessionName, lines: output.split('\n').length }, 'Pane captured');
    return output;
  } catch (error) {
    logger.error({ sessionName, error }, 'Failed to capture pane');
    throw error;
  }
}

/**
 * Capture pane content by pane ID (not session name)
 */
export async function capturePaneById(paneId: PaneId): Promise<string> {
  logger.debug({ paneId }, 'Capturing pane content by ID');

  try {
    const output = await execTmux([
      'capture-pane',
      '-t', paneId,
      '-p', // print to stdout
      '-J', // join wrapped lines
      '-S', '-50', // last 50 lines only
    ]);
    logger.debug({ paneId, lines: output.split('\n').length }, 'Pane captured');
    return output;
  } catch (error) {
    logger.error({ paneId, error }, 'Failed to capture pane by ID');
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
 * Send raw keys to a pane by ID without automatic Enter
 */
export async function sendKeysRawToPane(
  paneId: PaneId,
  keys: string
): Promise<void> {
  logger.debug({ paneId, keys }, 'Sending raw keys to pane');

  try {
    await execTmux([
      'send-keys',
      '-t', paneId,
      '-l', // literal flag - send exact characters
      keys,
    ]);
    logger.debug({ paneId }, 'Raw keys sent to pane successfully');
  } catch (error) {
    logger.error({ paneId, error }, 'Failed to send raw keys to pane');
    throw error;
  }
}

/**
 * Send special key to a pane by ID
 */
export async function sendSpecialKeyToPane(
  paneId: PaneId,
  key: 'Enter' | 'BSpace' | 'C-c' | 'Escape'
): Promise<void> {
  logger.debug({ paneId, key }, 'Sending special key to pane');

  try {
    await execTmux([
      'send-keys',
      '-t', paneId,
      key,
    ]);
    logger.debug({ paneId, key }, 'Special key sent to pane successfully');
  } catch (error) {
    logger.error({ paneId, key, error }, 'Failed to send special key to pane');
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

  // Read system prompt file content - --append-system-prompt requires inline text, not a file path
  const promptContent = await readFile(options.systemPromptPath, 'utf-8');

  // Launch Claude CLI with system prompt (use --append-system-prompt to preserve built-in capabilities)
  const claudeCommand = `claude --append-system-prompt ${escapeShellArg(promptContent)} --setting-sources project --session-id ${escapeShellArg(options.sessionId)}`;
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

    // Read system prompt file content - --append-system-prompt requires inline text, not a file path
    const promptContent = await readFile(options.systemPromptPath, 'utf-8');

    // Launch Claude CLI with system prompt (use --append-system-prompt to preserve built-in capabilities)
    const claudeCommand = `claude --append-system-prompt ${escapeShellArg(promptContent)} --setting-sources project --session-id ${escapeShellArg(options.sessionId)}`;
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

/**
 * Options for launching Claude CLI in a pane
 */
export interface ClaudeCLIInPaneOptions {
  /** System prompt content (not a file path) */
  systemPrompt: string;
  /** Working directory for Claude */
  workingDirectory: string;
  /** Session ID for Claude */
  sessionId: string;
  /** Split direction ('horizontal' = side-by-side, 'vertical' = top-bottom) */
  direction?: 'horizontal' | 'vertical';
  /** Percentage of space for the new pane */
  percentage?: number;
}

/**
 * Callbacks for Claude CLI in pane initialization
 */
export interface ClaudeCLIInPaneCallbacks {
  onProgress?: (elapsed: number) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Result of launching Claude CLI in a pane
 */
export interface ClaudeCLIInPaneResult {
  /** The pane ID where Claude is running */
  paneId: PaneId;
  /** Promise that resolves when Claude is ready */
  waitForReady: () => Promise<void>;
  /** Abort the readiness polling */
  abort: () => void;
}

/**
 * Launch Claude CLI in a split pane.
 * Creates a new pane and runs Claude directly in it, bypassing the detached session issue.
 * This is the preferred method when running inside tmux.
 */
export async function launchClaudeCLIInPane(
  options: ClaudeCLIInPaneOptions,
  callbacks?: ClaudeCLIInPaneCallbacks
): Promise<ClaudeCLIInPaneResult> {
  const direction = options.direction ?? 'horizontal';
  const percentage = options.percentage ?? 50;

  logger.info({ direction, percentage, workingDirectory: options.workingDirectory }, 'Launching Claude CLI in pane');

  // Build the Claude command
  const claudeCommand = `cd ${escapeShellArg(options.workingDirectory)} && claude --append-system-prompt ${escapeShellArg(options.systemPrompt)} --setting-sources project --session-id ${escapeShellArg(options.sessionId)}`;

  // Split pane and run Claude directly - the pane has dimensions immediately
  const paneId = await splitPaneWithCommand(direction, claudeCommand, percentage);
  logger.info({ paneId, direction }, 'Claude CLI pane created');

  // Background polling for readiness
  let aborted = false;
  const readyPromise = new Promise<void>((resolve, reject) => {
    (async () => {
      const maxAttempts = 90; // 90 seconds timeout
      for (let i = 0; i < maxAttempts && !aborted; i++) {
        await new Promise(r => setTimeout(r, 1000));
        callbacks?.onProgress?.(i + 1);

        try {
          const output = await capturePaneById(paneId);
          if (isClaudeReady(output)) {
            logger.info({ paneId, attempt: i + 1 }, 'Claude CLI ready in pane');
            callbacks?.onReady?.();
            resolve();
            return;
          }
        } catch {
          // Ignore capture errors during polling, continue trying
        }
      }

      if (!aborted) {
        const err = new TmuxError(
          'Claude CLI failed to initialize in pane',
          claudeCommand,
          undefined,
          `Timeout after ${maxAttempts}s`
        );
        logger.error({ paneId, timeout: maxAttempts }, 'Claude CLI initialization timeout in pane');
        callbacks?.onError?.(err);
        reject(err);
      }
    })();
  });

  return {
    paneId,
    waitForReady: () => readyPromise,
    abort: () => {
      aborted = true;
    },
  };
}
