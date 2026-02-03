/**
 * Agent role types and definitions
 */

import type { PaneId } from '../utils/tmux-utils.js';

// Branded types for compile-time safety
export type AgentId = string & { readonly __brand: 'AgentId' };
export type SessionName = string & { readonly __brand: 'SessionName' };

// Helper functions to create branded types
export function toAgentId(id: string): AgentId {
  return id as AgentId;
}

export function toSessionName(name: string): SessionName {
  return name as SessionName;
}

export type AgentRole =
  | 'product-manager'
  | 'architect'
  | 'test-engineer'
  | 'developer'
  | 'code-reviewer'
  | 'documenter';

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'error'
  | 'complete';

export interface Agent {
  id: AgentId;             // "pm", "architect", "dev-1", etc.
  role: AgentRole;         // Agent's specialized role
  sessionName: SessionName; // Tmux session name
  status: AgentStatus;     // Current status
  currentTask?: string | undefined;    // Path to task file being processed
  paneId?: PaneId | undefined;         // Pane ID when using pane-based approach (inside tmux)
}

export interface AgentConfig {
  role: AgentRole;
  sessionNamePrefix: string;
  instructions: string;
  alwaysRunning: boolean;  // Core agents vs on-demand workers
}

export interface AgentInstruction {
  agentId: AgentId;
  instruction: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export interface AgentOutput {
  agentId: AgentId;
  sessionName: SessionName;
  content: string;
  timestamp: Date;
  isComplete: boolean;
  hasError: boolean;
}

export interface AgentMonitorOptions {
  pollInterval?: number;  // Milliseconds between checks (default: 1000)
  timeout?: number;       // Maximum wait time in milliseconds
  onOutput?: (output: AgentOutput) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}
