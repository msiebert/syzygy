/**
 * StatusTab - Wrapper for existing status display
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { AgentStatus } from '../../types/agent.types.js';
import type { WorkflowState } from '../../types/workflow.types.js';

interface AgentStatusDisplay {
  id: string;
  role: string;
  status: AgentStatus;
  currentTask?: string | undefined;
}

interface StatusTabProps {
  workflowState: WorkflowState;
  agents: AgentStatusDisplay[];
  featureName: string;
  pmTerminalOpened: boolean;
  manualAttachCommand?: string | undefined;
}

/**
 * Get status icon for agent status
 */
function getStatusIcon(status: AgentStatus): string {
  switch (status) {
    case 'idle':
      return '[ ]';
    case 'working':
      return ''; // Will show spinner
    case 'waiting':
      return '[.]';
    case 'complete':
      return '[+]';
    case 'error':
      return '[X]';
    default:
      return '[ ]';
  }
}

/**
 * Get color for agent status
 */
function getStatusColor(status: AgentStatus): 'green' | 'yellow' | 'red' | 'blue' | 'gray' {
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
}

/**
 * Get workflow state display text
 */
function getWorkflowStateDisplay(state: WorkflowState): string {
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
}

/**
 * StatusTab component
 */
export function StatusTab({
  workflowState,
  agents,
  featureName,
  pmTerminalOpened,
  manualAttachCommand,
}: StatusTabProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Status
        </Text>
      </Box>

      {/* Feature name */}
      <Box marginBottom={1}>
        <Text>
          Feature: <Text bold>{featureName}</Text>
        </Text>
      </Box>

      {/* Workflow state */}
      <Box marginBottom={1}>
        <Text>
          State: <Text color="yellow">{getWorkflowStateDisplay(workflowState)}</Text>
        </Text>
      </Box>

      {/* PM terminal status */}
      {pmTerminalOpened && workflowState === 'spec_pending' && (
        <Box marginBottom={1}>
          <Text color="green">PM pane opened - interact with Claude in the right pane</Text>
        </Box>
      )}

      {/* Manual attach instructions */}
      {manualAttachCommand !== undefined && !pmTerminalOpened && workflowState === 'spec_pending' && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="yellow">
            Not running inside tmux. To interact with PM, run in another terminal:
          </Text>
          <Box marginTop={1}>
            <Text color="cyan" bold>
              {manualAttachCommand}
            </Text>
          </Box>
        </Box>
      )}

      {/* Agent list */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>
          Agents:
        </Text>
        {agents.map((agent) => (
          <Box key={agent.id} marginTop={0}>
            <Text color={getStatusColor(agent.status)}>
              {agent.status === 'working' ? (
                <>
                  <Spinner type="dots" /> {agent.role}
                  {agent.currentTask !== undefined && (
                    <Text dimColor> - {agent.currentTask}</Text>
                  )}
                </>
              ) : (
                <>
                  {getStatusIcon(agent.status)} {agent.role}
                </>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
