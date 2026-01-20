/**
 * Message format types for inter-agent communication
 */

export interface LockFile {
  agentId: string;
  claimedAt: string;  // ISO 8601 timestamp
  pid: number;        // Process ID
}

export interface TmuxSession {
  name: string;       // Session name (unique)
  agentId: string;    // Associated agent ID
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
  sessionName: string;
  content: string;    // Captured pane content
  timestamp: Date;
}
