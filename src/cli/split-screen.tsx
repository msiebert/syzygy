/**
 * Status display UI - Shows Syzygy workflow status
 * PM interaction happens in a separate terminal window
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

interface AgentInitProgress {
  agentId: string;
  status: 'initializing' | 'ready' | 'error';
  elapsed: number;
}

interface SyzygyStatusProps {
  workflowState: WorkflowState;
  agents: AgentStatusDisplay[];
  featureName: string;
  pmTerminalOpened: boolean;
  manualAttachCommand?: string | undefined;
}

/**
 * Syzygy status display component
 */
function SyzygyStatus({ workflowState, agents, featureName, pmTerminalOpened, manualAttachCommand }: SyzygyStatusProps): React.JSX.Element {
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

      {pmTerminalOpened && workflowState === 'spec_pending' && (
        <Box marginBottom={1}>
          <Text color="green">
            PM pane opened - interact with Claude in the right pane
          </Text>
        </Box>
      )}

      {manualAttachCommand && !pmTerminalOpened && workflowState === 'spec_pending' && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow">
            Not running inside tmux. To interact with PM, run in another terminal:
          </Text>
          <Box marginTop={0.5}>
            <Text color="cyan" bold>
              {manualAttachCommand}
            </Text>
          </Box>
        </Box>
      )}

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
 * Initialization status display component
 */
interface InitializationStatusProps {
  initProgress: AgentInitProgress[];
  isInitializing: boolean;
}

function InitializationStatus({
  initProgress,
  isInitializing,
}: InitializationStatusProps): React.JSX.Element | null {
  if (!isInitializing || initProgress.length === 0) {
    return null;
  }

  const getStatusIcon = (status: AgentInitProgress['status']): string => {
    switch (status) {
      case 'initializing':
        return '';  // Spinner will be shown instead
      case 'ready':
        return '[OK]';
      case 'error':
        return '[X]';
      default:
        return '';
    }
  };

  const getStatusColor = (status: AgentInitProgress['status']): 'yellow' | 'green' | 'red' => {
    switch (status) {
      case 'initializing':
        return 'yellow';
      case 'ready':
        return 'green';
      case 'error':
        return 'red';
      default:
        return 'yellow';
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
      <Box marginBottom={1}>
        <Text bold color="yellow">
          Initializing Agents...
        </Text>
      </Box>

      <Box flexDirection="column">
        {initProgress.map((progress) => (
          <Box key={progress.agentId} marginTop={0.5}>
            <Text color={getStatusColor(progress.status)}>
              {progress.status === 'initializing' ? (
                <>
                  <Spinner type="dots" /> {progress.agentId}: Starting Claude CLI ({progress.elapsed}s)
                </>
              ) : (
                <>
                  {getStatusIcon(progress.status)} {progress.agentId}:{' '}
                  {progress.status === 'ready' ? 'Ready' : 'Failed'}
                </>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Status-only screen layout
 */
interface StatusScreenProps {
  featureName: string;
  workflowState: WorkflowState;
  agents: AgentStatusDisplay[];
  initProgress: AgentInitProgress[];
  isInitializing: boolean;
  pmTerminalOpened: boolean;
  manualAttachCommand?: string | undefined;
}

function StatusScreen({
  featureName,
  workflowState,
  agents,
  initProgress,
  isInitializing,
  pmTerminalOpened,
  manualAttachCommand,
}: StatusScreenProps): React.JSX.Element {
  return (
    <Box flexDirection="column" height="100%">
      {/* Initialization Status - shown during agent init */}
      {isInitializing && (
        <Box marginBottom={1}>
          <InitializationStatus
            initProgress={initProgress}
            isInitializing={isInitializing}
          />
        </Box>
      )}

      {/* Syzygy Status */}
      <Box>
        <SyzygyStatus
          workflowState={workflowState}
          agents={agents}
          featureName={featureName}
          pmTerminalOpened={pmTerminalOpened}
          manualAttachCommand={manualAttachCommand}
        />
      </Box>
    </Box>
  );
}

/**
 * Split screen controller - now simplified to status-only display
 */
export class SplitScreenController {
  private app: ReturnType<typeof render> | undefined;
  private featureName: string;
  private workflowState: WorkflowState = 'idle';
  private agents: AgentStatusDisplay[] = [];
  private updateCallback: (() => void) | undefined;
  private initProgressMap: Map<string, AgentInitProgress> = new Map();
  private isInitializing = true;
  private pmTerminalOpened = false;
  private manualAttachCommand: string | undefined = undefined;

  constructor(featureName: string) {
    this.featureName = featureName;
  }

  /**
   * Update initialization progress for an agent
   */
  updateInitProgress(
    agentId: string,
    status: 'initializing' | 'ready' | 'error',
    elapsed: number
  ): void {
    this.initProgressMap.set(agentId, { agentId, status, elapsed });
    this.triggerUpdate();
  }

  /**
   * Mark initialization as complete (hide initialization panel)
   */
  setInitializationComplete(): void {
    this.isInitializing = false;
    this.triggerUpdate();
  }

  /**
   * Mark that PM terminal window has been opened
   */
  setPMTerminalOpened(): void {
    this.pmTerminalOpened = true;
    this.manualAttachCommand = undefined; // Clear manual attach if pane opened
    this.triggerUpdate();
  }

  /**
   * Show manual attach instructions when not running inside tmux
   */
  showManualAttachInstructions(command: string): void {
    this.manualAttachCommand = command;
    this.triggerUpdate();
  }

  /**
   * Get current initialization progress as array
   */
  private getInitProgress(): AgentInitProgress[] {
    return Array.from(this.initProgressMap.values());
  }

  /**
   * Start displaying the status screen
   */
  start(): void {
    if (this.app) {
      logger.warn('Status screen already started');
      return;
    }

    const StatusScreenWrapper = () => {
      const [, forceUpdate] = useState({});

      useEffect(() => {
        this.updateCallback = () => forceUpdate({});
        return () => {
          this.updateCallback = undefined;
        };
      }, []);

      return (
        <StatusScreen
          featureName={this.featureName}
          workflowState={this.workflowState}
          agents={this.agents}
          initProgress={this.getInitProgress()}
          isInitializing={this.isInitializing}
          pmTerminalOpened={this.pmTerminalOpened}
          manualAttachCommand={this.manualAttachCommand}
        />
      );
    };

    this.app = render(<StatusScreenWrapper />);
    logger.info('Status screen started');
  }

  /**
   * Stop displaying the status screen
   */
  stop(): void {
    if (this.app) {
      this.app.unmount();
      this.app = undefined;
      logger.info('Status screen stopped');
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
      await app.waitUntilExit();
    },
  };
}
