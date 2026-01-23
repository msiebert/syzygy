/**
 * Unit tests for agent configuration
 */

import { describe, it, expect } from 'bun:test';
import {
  AGENT_CONFIGS,
  getAgentConfig,
  getAlwaysRunningAgents,
  getOnDemandAgents,
  getSessionName,
  supportsMultipleInstances,
  getWorkflowOrder,
} from '../../src/agents/agent-config.js';
import type { AgentRole } from '../../src/types/agent.types.js';
import { toSessionName } from '../../src/types/agent.types.js';

describe('agent-config', () => {
  describe('AGENT_CONFIGS', () => {
    it('should have exactly 6 agent configurations', () => {
      expect(AGENT_CONFIGS).toHaveLength(6);
    });

    it('should have all required agent roles', () => {
      const roles = AGENT_CONFIGS.map(config => config.role);
      expect(roles).toContain('product-manager');
      expect(roles).toContain('architect');
      expect(roles).toContain('test-engineer');
      expect(roles).toContain('developer');
      expect(roles).toContain('code-reviewer');
      expect(roles).toContain('documenter');
    });

    it('should have unique session name prefixes', () => {
      const prefixes = AGENT_CONFIGS.map(config => config.sessionNamePrefix);
      const uniquePrefixes = new Set(prefixes);
      expect(uniquePrefixes.size).toBe(AGENT_CONFIGS.length);
    });

    it('should have correct session name prefixes', () => {
      expect(getAgentConfig('product-manager')?.sessionNamePrefix).toBe('syzygy-pm');
      expect(getAgentConfig('architect')?.sessionNamePrefix).toBe('syzygy-architect');
      expect(getAgentConfig('test-engineer')?.sessionNamePrefix).toBe('syzygy-test-engineer');
      expect(getAgentConfig('developer')?.sessionNamePrefix).toBe('syzygy-dev');
      expect(getAgentConfig('code-reviewer')?.sessionNamePrefix).toBe('syzygy-reviewer');
      expect(getAgentConfig('documenter')?.sessionNamePrefix).toBe('syzygy-documenter');
    });

    it('should mark PM and Architect as always running', () => {
      expect(getAgentConfig('product-manager')?.alwaysRunning).toBe(true);
      expect(getAgentConfig('architect')?.alwaysRunning).toBe(true);
    });

    it('should mark workers as on-demand', () => {
      expect(getAgentConfig('test-engineer')?.alwaysRunning).toBe(false);
      expect(getAgentConfig('developer')?.alwaysRunning).toBe(false);
      expect(getAgentConfig('code-reviewer')?.alwaysRunning).toBe(false);
      expect(getAgentConfig('documenter')?.alwaysRunning).toBe(false);
    });
  });

  describe('getAgentConfig', () => {
    it('should return config for valid role', () => {
      const config = getAgentConfig('architect');
      expect(config).toBeDefined();
      expect(config?.role).toBe('architect');
    });

    it('should return undefined for unknown role', () => {
      const config = getAgentConfig('unknown-role' as AgentRole);
      expect(config).toBeUndefined();
    });

    it('should return correct config for each role', () => {
      const roles: AgentRole[] = [
        'product-manager',
        'architect',
        'test-engineer',
        'developer',
        'code-reviewer',
        'documenter',
      ];

      for (const role of roles) {
        const config = getAgentConfig(role);
        expect(config?.role).toBe(role);
      }
    });
  });

  describe('getAlwaysRunningAgents', () => {
    it('should return exactly 2 always-running agents', () => {
      const agents = getAlwaysRunningAgents();
      expect(agents).toHaveLength(2);
    });

    it('should return PM and Architect', () => {
      const agents = getAlwaysRunningAgents();
      const roles = agents.map(a => a.role);
      expect(roles).toContain('product-manager');
      expect(roles).toContain('architect');
    });

    it('should not include on-demand workers', () => {
      const agents = getAlwaysRunningAgents();
      const roles = agents.map(a => a.role);
      expect(roles).not.toContain('developer');
      expect(roles).not.toContain('test-engineer');
      expect(roles).not.toContain('code-reviewer');
      expect(roles).not.toContain('documenter');
    });
  });

  describe('getOnDemandAgents', () => {
    it('should return exactly 4 on-demand agents', () => {
      const agents = getOnDemandAgents();
      expect(agents).toHaveLength(4);
    });

    it('should return all worker agents', () => {
      const agents = getOnDemandAgents();
      const roles = agents.map(a => a.role);
      expect(roles).toContain('test-engineer');
      expect(roles).toContain('developer');
      expect(roles).toContain('code-reviewer');
      expect(roles).toContain('documenter');
    });

    it('should not include core agents', () => {
      const agents = getOnDemandAgents();
      const roles = agents.map(a => a.role);
      expect(roles).not.toContain('product-manager');
      expect(roles).not.toContain('architect');
    });
  });

  describe('getSessionName', () => {
    it('should generate session name without instance', () => {
      expect(getSessionName('product-manager')).toBe(toSessionName('syzygy-pm'));
      expect(getSessionName('architect')).toBe(toSessionName('syzygy-architect'));
    });

    it('should generate session name with instance', () => {
      expect(getSessionName('developer', 1)).toBe(toSessionName('syzygy-dev-1'));
      expect(getSessionName('developer', 2)).toBe(toSessionName('syzygy-dev-2'));
    });

    it('should handle instance for non-parallel agents', () => {
      expect(getSessionName('architect', 1)).toBe(toSessionName('syzygy-architect-1'));
    });

    it('should throw for unknown role', () => {
      expect(() => getSessionName('unknown' as AgentRole)).toThrow('Unknown agent role');
    });
  });

  describe('supportsMultipleInstances', () => {
    it('should return true for developer role', () => {
      expect(supportsMultipleInstances('developer')).toBe(true);
    });

    it('should return false for all other roles', () => {
      expect(supportsMultipleInstances('product-manager')).toBe(false);
      expect(supportsMultipleInstances('architect')).toBe(false);
      expect(supportsMultipleInstances('test-engineer')).toBe(false);
      expect(supportsMultipleInstances('code-reviewer')).toBe(false);
      expect(supportsMultipleInstances('documenter')).toBe(false);
    });
  });

  describe('getWorkflowOrder', () => {
    it('should return all 6 roles in order', () => {
      const order = getWorkflowOrder();
      expect(order).toHaveLength(6);
    });

    it('should have correct workflow sequence', () => {
      const order = getWorkflowOrder();
      expect(order[0]).toBe('product-manager');
      expect(order[1]).toBe('architect');
      expect(order[2]).toBe('test-engineer');
      expect(order[3]).toBe('developer');
      expect(order[4]).toBe('code-reviewer');
      expect(order[5]).toBe('documenter');
    });

    it('should match linear workflow: PM → Arch → Test → Dev → Review → Docs', () => {
      const order = getWorkflowOrder();
      expect(order).toEqual([
        'product-manager',
        'architect',
        'test-engineer',
        'developer',
        'code-reviewer',
        'documenter',
      ]);
    });
  });
});
