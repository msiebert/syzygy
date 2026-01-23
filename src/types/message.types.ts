/**
 * Message format types for inter-agent communication
 */

import type { AgentId, SessionName } from './agent.types.js';

export interface LockFile {
  agentId: string;
  claimedAt: string;  // ISO 8601 timestamp
  pid: number;        // Process ID
}

export interface TmuxSession {
  name: SessionName;  // Session name (unique)
  agentId: AgentId;   // Associated agent ID
  windowId: string;   // Tmux window ID
  paneId: string;     // Tmux pane ID
  pid: number;        // Process ID
  createdAt: Date;
}

export interface TmuxCommand {
  command: string;
  args: string[];
}

export interface TmuxPaneCapture {
  sessionName: SessionName;
  content: string;    // Captured pane content
  timestamp: Date;
}

export class SessionError extends Error {
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    public readonly agentId: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SessionError';
    this.context = context;
  }
}

export class AgentRunnerError extends Error {
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    public readonly sessionName: SessionName,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentRunnerError';
    this.context = context;
  }
}

export class WorkflowEngineError extends Error {
  public readonly attemptedState: string | undefined;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    public readonly currentState: string,
    attemptedState?: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WorkflowEngineError';
    this.attemptedState = attemptedState;
    this.context = context;
  }
}

export class FileMonitorError extends Error {
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    public readonly path: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'FileMonitorError';
    this.context = context;
  }
}
