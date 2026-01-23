/**
 * Agent role configurations
 *
 * Defines the 6 specialized agent roles in the Syzygy workflow:
 * - Product Manager (PM): Interviews user, writes specs
 * - Architect: Designs architecture, breaks work into tasks
 * - Test Engineer: Creates test suites before implementation
 * - Developer: Implements code to pass tests (parallel-capable)
 * - Code Reviewer: Reviews implementations for quality
 * - Documenter: Updates all project documentation
 */

import type { AgentRole, AgentConfig, SessionName } from '../types/agent.types.js';
import { toSessionName } from '../types/agent.types.js';

/**
 * Configuration for each agent role
 */
export const AGENT_CONFIGS: AgentConfig[] = [
  {
    role: 'product-manager',
    sessionNamePrefix: 'syzygy-pm',
    instructions: '', // Populated by agent-instructions.ts
    alwaysRunning: true, // Core agent, always active
  },
  {
    role: 'architect',
    sessionNamePrefix: 'syzygy-architect',
    instructions: '',
    alwaysRunning: true, // Core agent, always active
  },
  {
    role: 'test-engineer',
    sessionNamePrefix: 'syzygy-test-engineer',
    instructions: '',
    alwaysRunning: false, // On-demand worker
  },
  {
    role: 'developer',
    sessionNamePrefix: 'syzygy-dev', // Will be suffixed with -1, -2, etc.
    instructions: '',
    alwaysRunning: false, // On-demand worker (default: 1 instance)
  },
  {
    role: 'code-reviewer',
    sessionNamePrefix: 'syzygy-reviewer',
    instructions: '',
    alwaysRunning: false, // On-demand worker
  },
  {
    role: 'documenter',
    sessionNamePrefix: 'syzygy-documenter',
    instructions: '',
    alwaysRunning: false, // On-demand worker
  },
];

/**
 * Get configuration for a specific agent role
 */
export function getAgentConfig(role: AgentRole): AgentConfig | undefined {
  return AGENT_CONFIGS.find(config => config.role === role);
}

/**
 * Get all core agents that should always be running
 */
export function getAlwaysRunningAgents(): AgentConfig[] {
  return AGENT_CONFIGS.filter(config => config.alwaysRunning);
}

/**
 * Get all on-demand worker agents
 */
export function getOnDemandAgents(): AgentConfig[] {
  return AGENT_CONFIGS.filter(config => !config.alwaysRunning);
}

/**
 * Generate session name for an agent
 *
 * @param role - Agent role
 * @param instance - Instance number (for parallel workers like developers)
 * @returns Full tmux session name
 *
 * @example
 * getSessionName('developer', 1) // 'syzygy-dev-1'
 * getSessionName('architect') // 'syzygy-architect'
 */
export function getSessionName(role: AgentRole, instance?: number): SessionName {
  const config = getAgentConfig(role);
  if (!config) {
    throw new Error(`Unknown agent role: ${role}`);
  }

  const prefix = config.sessionNamePrefix;

  // For roles that support multiple instances (like developers)
  if (instance !== undefined) {
    return toSessionName(`${prefix}-${instance}`);
  }

  return toSessionName(prefix);
}

/**
 * Check if an agent role supports multiple instances
 */
export function supportsMultipleInstances(role: AgentRole): boolean {
  // Currently only developers support multiple instances
  return role === 'developer';
}

/**
 * Get all agent roles in workflow order
 */
export function getWorkflowOrder(): AgentRole[] {
  return [
    'product-manager',
    'architect',
    'test-engineer',
    'developer',
    'code-reviewer',
    'documenter',
  ];
}
