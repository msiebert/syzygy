/**
 * Unit tests for AgentCompletionTracker
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCompletionTracker } from '@core/agent-completion-tracker';
import { toAgentId } from '../../src/types/agent.types';
import type { InstructionContext } from '../../src/agents/agent-instructions';

describe('AgentCompletionTracker', () => {
  let tracker: AgentCompletionTracker;

  beforeEach(() => {
    tracker = new AgentCompletionTracker();
  });

  describe('registerWork', () => {
    it('should register work for an architect', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'architect', context);

      expect(tracker.isTracking(agentId)).toBe(true);
      expect(tracker.getPendingAgents()).toContain(agentId);
    });

    it('should register work for a developer with taskId', () => {
      const agentId = toAgentId('developer-1');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
        taskId: 'task-1',
      };

      tracker.registerWork(agentId, 'developer', context);

      expect(tracker.isTracking(agentId)).toBe(true);
      const outputs = tracker.getExpectedOutputs(agentId);
      expect(outputs).toHaveLength(1);
      expect(outputs?.[0]?.stageName).toBe('impl');
    });

    it('should register multiple possible outputs for code-reviewer', () => {
      const agentId = toAgentId('code-reviewer');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
        taskId: 'task-1',
      };

      tracker.registerWork(agentId, 'code-reviewer', context);

      const outputs = tracker.getExpectedOutputs(agentId);
      expect(outputs).toHaveLength(2);

      const stageNames = outputs?.map(o => o.stageName);
      expect(stageNames).toContain('review');
      expect(stageNames).toContain('tasks');
    });
  });

  describe('checkFileCreated', () => {
    it('should detect architect completion via architecture.md', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'architect', context);

      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/user-auth-architecture.md',
        'arch'
      );

      expect(completion).not.toBeNull();
      expect(completion?.agentId).toBe(agentId);
      expect(completion?.role).toBe('architect');
      expect(completion?.stageName).toBe('arch');
    });

    it('should detect test-engineer completion via tests file', () => {
      const agentId = toAgentId('test-engineer');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'test-engineer', context);

      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/tests/pending/user-auth-tests.ts',
        'tests'
      );

      expect(completion).not.toBeNull();
      expect(completion?.agentId).toBe(agentId);
      expect(completion?.role).toBe('test-engineer');
    });

    it('should detect developer completion via implementation file', () => {
      const agentId = toAgentId('developer-1');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
        taskId: 'task-1',
      };

      tracker.registerWork(agentId, 'developer', context);

      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/impl/pending/user-auth-task-1-implementation.md',
        'impl'
      );

      expect(completion).not.toBeNull();
      expect(completion?.agentId).toBe(agentId);
      expect(completion?.role).toBe('developer');
    });

    it('should detect code-reviewer approval via review file', () => {
      const agentId = toAgentId('code-reviewer');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
        taskId: 'task-1',
      };

      tracker.registerWork(agentId, 'code-reviewer', context);

      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/review/pending/user-auth-task-1-review.md',
        'review'
      );

      expect(completion).not.toBeNull();
      expect(completion?.agentId).toBe(agentId);
      expect(completion?.role).toBe('code-reviewer');
    });

    it('should detect code-reviewer fixes request via tasks file', () => {
      const agentId = toAgentId('code-reviewer');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
        taskId: 'task-1',
      };

      tracker.registerWork(agentId, 'code-reviewer', context);

      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/tasks/pending/user-auth-task-1-fixes.md',
        'tasks'
      );

      expect(completion).not.toBeNull();
      expect(completion?.agentId).toBe(agentId);
      expect(completion?.role).toBe('code-reviewer');
    });

    it('should detect documenter completion via documentation file', () => {
      const agentId = toAgentId('documenter');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'documenter', context);

      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/docs/pending/user-auth-documentation.md',
        'docs'
      );

      expect(completion).not.toBeNull();
      expect(completion?.agentId).toBe(agentId);
      expect(completion?.role).toBe('documenter');
    });

    it('should return null for untracked files', () => {
      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/some-architecture.md',
        'arch'
      );

      expect(completion).toBeNull();
    });

    it('should return null for wrong stage', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'architect', context);

      // Wrong stage - spec instead of arch
      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/spec/pending/user-auth-architecture.md',
        'spec'
      );

      expect(completion).toBeNull();
    });

    it('should return null for wrong filename pattern', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'architect', context);

      // Wrong filename pattern - different feature slug
      const completion = tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/other-feature-architecture.md',
        'arch'
      );

      expect(completion).toBeNull();
    });

    it('should remove agent from tracking after completion', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'architect', context);
      expect(tracker.isTracking(agentId)).toBe(true);

      tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/user-auth-architecture.md',
        'arch'
      );

      expect(tracker.isTracking(agentId)).toBe(false);
    });
  });

  describe('cancelWork', () => {
    it('should remove agent from tracking', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId, 'architect', context);
      expect(tracker.isTracking(agentId)).toBe(true);

      tracker.cancelWork(agentId);

      expect(tracker.isTracking(agentId)).toBe(false);
    });

    it('should handle cancelling non-existent agent gracefully', () => {
      const agentId = toAgentId('non-existent');

      // Should not throw
      tracker.cancelWork(agentId);

      expect(tracker.isTracking(agentId)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all pending work', () => {
      const agentId1 = toAgentId('architect');
      const agentId2 = toAgentId('developer-1');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
      };

      tracker.registerWork(agentId1, 'architect', context);
      tracker.registerWork(agentId2, 'developer', context);

      expect(tracker.getPendingAgents()).toHaveLength(2);

      tracker.clear();

      expect(tracker.getPendingAgents()).toHaveLength(0);
    });
  });

  describe('multiple agents', () => {
    it('should track multiple agents independently', () => {
      const architectId = toAgentId('architect');
      const developerId = toAgentId('developer-1');
      const context: InstructionContext = {
        featureName: 'User Authentication',
        featureSlug: 'user-auth',
        taskId: 'task-1',
      };

      tracker.registerWork(architectId, 'architect', context);
      tracker.registerWork(developerId, 'developer', context);

      expect(tracker.getPendingAgents()).toHaveLength(2);

      // Complete architect
      const archCompletion = tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/user-auth-architecture.md',
        'arch'
      );

      expect(archCompletion).not.toBeNull();
      expect(archCompletion?.agentId).toBe(architectId);
      expect(tracker.isTracking(architectId)).toBe(false);
      expect(tracker.isTracking(developerId)).toBe(true);

      // Complete developer
      const devCompletion = tracker.checkFileCreated(
        '/project/.syzygy/stages/impl/pending/user-auth-task-1-implementation.md',
        'impl'
      );

      expect(devCompletion).not.toBeNull();
      expect(devCompletion?.agentId).toBe(developerId);
      expect(tracker.getPendingAgents()).toHaveLength(0);
    });
  });

  describe('special characters in feature slug', () => {
    it('should escape regex special characters in feature slug', () => {
      const agentId = toAgentId('architect');
      const context: InstructionContext = {
        featureName: 'Feature (v2.0)',
        featureSlug: 'feature-v2.0',
      };

      tracker.registerWork(agentId, 'architect', context);

      // The dot in v2.0 should be escaped, so this should NOT match
      const wrongMatch = tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/feature-v2X0-architecture.md',
        'arch'
      );
      expect(wrongMatch).toBeNull();

      // This should match
      const correctMatch = tracker.checkFileCreated(
        '/project/.syzygy/stages/arch/pending/feature-v2.0-architecture.md',
        'arch'
      );
      expect(correctMatch).not.toBeNull();
    });
  });
});
