/**
 * Agent role types and definitions
 */

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
  id: string;              // "pm", "architect", "dev-1", etc.
  role: AgentRole;         // Agent's specialized role
  sessionName: string;     // Tmux session name
  status: AgentStatus;     // Current status
  currentTask?: string;    // Path to task file being processed
}

export interface AgentConfig {
  role: AgentRole;
  sessionNamePrefix: string;
  instructions: string;
  alwaysRunning: boolean;  // Core agents vs on-demand workers
}

export interface AgentInstruction {
  agentId: string;
  instruction: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export interface AgentOutput {
  agentId: string;
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
