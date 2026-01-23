/**
 * Split screen UI - PM chat + Syzygy status
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Agent, AgentStatus } from '../types/agent.types.js';
import type { WorkflowState } from '../types/workflow.types.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('split-screen');

interface AgentStatusDisplay {
  id: string;
  role: string;
  status: AgentStatus;
  currentTask?: string | undefined;
}

interface SyzygyStatusProps {
  workflowState: WorkflowState;
  agents: AgentStatusDisplay[];
  featureName: string;
}

/**
 * Syzygy status display component
 */
function SyzygyStatus({ workflowState, agents, featureName }: SyzygyStatusProps): React.JSX.Element {
  const getStatusIcon = (status: AgentStatus): string => {
    switch (status) {
      case 'idle':
        return '⏸️';
      case 'working':
        return '⚙️';
      case 'waiting':
        return '⏳';
      case 'complete':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '•';
    }
  };

  const getStatusColor = (status: AgentStatus): 'green' | 'yellow' | 'red' | 'blue' | 'gray' => {
    switch (status) {
      case 'working':
        return 'yellow';
      case 'complete':
        return 'green';
      case 'error':
        return 'red';
      case 'waiting':
        return 'blue';
      default:
        return 'gray';
    }
  };

  const getWorkflowStateDisplay = (state: WorkflowState): string => {
    switch (state) {
      case 'idle':
        return 'Idle';
      case 'spec_pending':
        return 'Writing Specification';
      case 'arch_pending':
        return 'Designing Architecture';
      case 'tests_pending':
        return 'Creating Tests';
      case 'impl_pending':
        return 'Implementing Code';
      case 'review_pending':
        return 'Reviewing Code';
      case 'docs_pending':
        return 'Updating Documentation';
      case 'complete':
        return 'Complete';
      case 'error':
        return 'Error';
      default:
        return state;
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Syzygy Status
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          Feature: <Text bold>{featureName}</Text>
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          State: <Text color="yellow">{getWorkflowStateDisplay(workflowState)}</Text>
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold dimColor>
          Agents:
        </Text>
        {agents.map((agent) => (
          <Box key={agent.id} marginTop={0.5}>
            <Text color={getStatusColor(agent.status)}>
              {getStatusIcon(agent.status)} {agent.role}
              {agent.status === 'working' && agent.currentTask && (
                <Text dimColor> - {agent.currentTask}</Text>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * PM Chat display component
 */
interface PMChatProps {
  messages: ChatMessage[];
}

export interface ChatMessage {
  from: 'user' | 'pm';
  text: string;
  timestamp: Date;
}

function PMChat({ messages }: PMChatProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="green">
      <Box marginBottom={1}>
        <Text bold color="green">
          Product Manager Chat
        </Text>
      </Box>

      <Box flexDirection="column">
        {messages.length === 0 ? (
          <Text dimColor>Waiting for Product Manager...</Text>
        ) : (
          messages.map((msg, index) => (
            <Box key={index} marginTop={0.5}>
              <Text color={msg.from === 'user' ? 'cyan' : 'green'}>
                {msg.from === 'user' ? 'You' : 'PM'}:
              </Text>
              <Text> {msg.text}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

/**
 * Split screen layout
 */
interface SplitScreenProps {
  featureName: string;
  workflowState: WorkflowState;
  agents: AgentStatusDisplay[];
  chatMessages: ChatMessage[];
}

function SplitScreen({
  featureName,
  workflowState,
  agents,
  chatMessages,
}: SplitScreenProps): React.JSX.Element {
  return (
    <Box flexDirection="column" height="100%">
      {/* PM Chat - Top Half */}
      <Box flexGrow={1}>
        <PMChat messages={chatMessages} />
      </Box>

      {/* Syzygy Status - Bottom Half */}
      <Box marginTop={1}>
        <SyzygyStatus workflowState={workflowState} agents={agents} featureName={featureName} />
      </Box>
    </Box>
  );
}

/**
 * Ensure stdin is in correct state for Ink rendering
 */
function ensureStdinReady(): void {
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }

  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }

  process.stdin.ref();
}

/**
 * Split screen controller
 */
export class SplitScreenController {
  private app: ReturnType<typeof render> | undefined;
  private featureName: string;
  private workflowState: WorkflowState = 'idle';
  private agents: AgentStatusDisplay[] = [];
  private chatMessages: ChatMessage[] = [];
  private updateCallback: (() => void) | undefined;

  constructor(featureName: string) {
    this.featureName = featureName;
  }

  /**
   * Start displaying the split screen
   */
  start(): void {
    if (this.app) {
      logger.warn('Split screen already started');
      return;
    }

    // Ensure stdin is ready before rendering
    ensureStdinReady();

    const SplitScreenWrapper = () => {
      const [, forceUpdate] = useState({});

      useEffect(() => {
        this.updateCallback = () => forceUpdate({});
        return () => {
          this.updateCallback = undefined;
        };
      }, []);

      return (
        <SplitScreen
          featureName={this.featureName}
          workflowState={this.workflowState}
          agents={this.agents}
          chatMessages={this.chatMessages}
        />
      );
    };

    this.app = render(<SplitScreenWrapper />);
    logger.info('Split screen started');
  }

  /**
   * Stop displaying the split screen
   */
  stop(): void {
    if (this.app) {
      this.app.unmount();
      this.app = undefined;
      logger.info('Split screen stopped');
    }
  }

  /**
   * Update workflow state
   */
  updateWorkflowState(state: WorkflowState): void {
    this.workflowState = state;
    this.triggerUpdate();
  }

  /**
   * Update agents status
   */
  updateAgents(agents: Agent[]): void {
    this.agents = agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      status: agent.status,
      currentTask: agent.currentTask,
    }));
    this.triggerUpdate();
  }

  /**
   * Add a chat message
   */
  addChatMessage(from: 'user' | 'pm', text: string): void {
    this.chatMessages.push({
      from,
      text,
      timestamp: new Date(),
    });
    this.triggerUpdate();
  }

  /**
   * Clear chat messages
   */
  clearChat(): void {
    this.chatMessages = [];
    this.triggerUpdate();
  }

  /**
   * Get current chat messages
   */
  getChatMessages(): ChatMessage[] {
    return [...this.chatMessages];
  }

  /**
   * Trigger UI update
   */
  private triggerUpdate(): void {
    if (this.updateCallback) {
      this.updateCallback();
    }
  }
}

/**
 * Create a loading indicator
 */
interface LoadingIndicatorProps {
  message: string;
}

export function LoadingIndicator({ message }: LoadingIndicatorProps): React.JSX.Element {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {message}</Text>
    </Box>
  );
}

/**
 * Show a simple loading screen
 */
export function showLoadingScreen(message: string): { stop: () => Promise<void> } {
  const app = render(<LoadingIndicator message={message} />);

  return {
    stop: async () => {
      app.unmount();
      await app.waitUntilExit(); // Wait for Ink cleanup

      // Explicitly normalize stdin
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }
      process.stdin.resume();
    },
  };
}
