/**
 * Unit tests for WorkflowEngine
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { WorkflowEngine } from '@core/workflow-engine';
import { WorkflowEngineError } from '../../src/types/message.types';
import type { WorkflowEvent, WorkflowState } from '../../src/types/workflow.types';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  const featureName = 'test-feature';
  const initialPrompt = 'This is a test feature description';

  beforeEach(() => {
    engine = new WorkflowEngine(featureName, initialPrompt);
  });

  describe('initialization', () => {
    it('should initialize with idle state', () => {
      expect(engine.getCurrentState()).toBe('idle');
    });

    it('should store feature name in context', () => {
      const context = engine.getContext();
      expect(context.featureName).toBe(featureName);
    });

    it('should store initial prompt in context', () => {
      const context = engine.getContext();
      expect(context.initialPrompt).toBe(initialPrompt);
    });

    it('should set startedAt timestamp', () => {
      const context = engine.getContext();
      expect(context.startedAt).toBeInstanceOf(Date);
    });
  });

  describe('getCurrentState', () => {
    it('should return current workflow state', () => {
      expect(engine.getCurrentState()).toBe('idle');
    });

    it('should reflect state after transition', () => {
      engine.transitionTo('spec_pending');
      expect(engine.getCurrentState()).toBe('spec_pending');
    });
  });

  describe('getContext', () => {
    it('should return workflow context', () => {
      const context = engine.getContext();

      expect(context.featureName).toBe(featureName);
      expect(context.state).toBe('idle');
      expect(context.startedAt).toBeInstanceOf(Date);
    });

    it('should return a copy of context', () => {
      const context1 = engine.getContext();
      const context2 = engine.getContext();

      expect(context1).not.toBe(context2);
      expect(context1).toEqual(context2);
    });
  });

  describe('getInitialPrompt', () => {
    it('should return the initial prompt', () => {
      expect(engine.getInitialPrompt()).toBe(initialPrompt);
    });
  });

  describe('canTransition', () => {
    it('should allow valid transitions from idle', () => {
      expect(engine.canTransition('spec_pending')).toBe(true);
      expect(engine.canTransition('error')).toBe(true);
    });

    it('should reject invalid transitions from idle', () => {
      expect(engine.canTransition('arch_pending')).toBe(false);
      expect(engine.canTransition('complete')).toBe(false);
    });

    it('should allow valid transitions from spec_pending', () => {
      engine.transitionTo('spec_pending');

      expect(engine.canTransition('arch_pending')).toBe(true);
      expect(engine.canTransition('error')).toBe(true);
    });

    it('should allow loopback from review_pending to impl_pending', () => {
      // Transition through the workflow to review_pending
      engine.transitionTo('spec_pending');
      engine.transitionTo('arch_pending');
      engine.transitionTo('tests_pending');
      engine.transitionTo('impl_pending');
      engine.transitionTo('review_pending');

      expect(engine.canTransition('impl_pending')).toBe(true);
      expect(engine.canTransition('docs_pending')).toBe(true);
    });

    it('should allow transition from complete back to idle', () => {
      // Transition through entire workflow
      engine.transitionTo('spec_pending');
      engine.transitionTo('arch_pending');
      engine.transitionTo('tests_pending');
      engine.transitionTo('impl_pending');
      engine.transitionTo('review_pending');
      engine.transitionTo('docs_pending');
      engine.transitionTo('complete');

      expect(engine.canTransition('idle')).toBe(true);
    });

    it('should allow transition from error to idle', () => {
      engine.transitionToError('Test error', 'agent-1', 'test-stage');

      expect(engine.canTransition('idle')).toBe(true);
    });
  });

  describe('transitionTo', () => {
    it('should transition to valid state', () => {
      engine.transitionTo('spec_pending');

      expect(engine.getCurrentState()).toBe('spec_pending');
    });

    it('should throw WorkflowEngineError for invalid transition', () => {
      expect(() => {
        engine.transitionTo('complete');
      }).toThrow(WorkflowEngineError);
    });

    it('should include current and attempted state in error', () => {
      try {
        engine.transitionTo('complete');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowEngineError);
        expect((error as WorkflowEngineError).currentState).toBe('idle');
        expect((error as WorkflowEngineError).attemptedState).toBe('complete');
      }
    });

    it('should set completedAt when reaching complete state', () => {
      // Transition through entire workflow
      engine.transitionTo('spec_pending');
      engine.transitionTo('arch_pending');
      engine.transitionTo('tests_pending');
      engine.transitionTo('impl_pending');
      engine.transitionTo('review_pending');
      engine.transitionTo('docs_pending');

      const beforeComplete = engine.getContext();
      expect(beforeComplete.completedAt).toBeUndefined();

      engine.transitionTo('complete');

      const afterComplete = engine.getContext();
      expect(afterComplete.completedAt).toBeInstanceOf(Date);
    });

    it('should emit state:transition event', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      engine.on('state:transition', listener);

      engine.transitionTo('spec_pending');

      expect(listener).toHaveBeenCalledTimes(1);

      const event = listener.mock.calls[0]![0] as WorkflowEvent;
      expect(event.type).toBe('state:transition');
      expect(event.payload).toMatchObject({
        from: 'idle',
        to: 'spec_pending',
        featureName,
      });
    });

    it('should allow full workflow progression', () => {
      const states: WorkflowState[] = [
        'spec_pending',
        'arch_pending',
        'tests_pending',
        'impl_pending',
        'review_pending',
        'docs_pending',
        'complete',
      ];

      for (const state of states) {
        engine.transitionTo(state);
        expect(engine.getCurrentState()).toBe(state);
      }
    });
  });

  describe('transitionToError', () => {
    it('should transition to error state', () => {
      engine.transitionToError('Test error', 'agent-1', 'test-stage');

      expect(engine.getCurrentState()).toBe('error');
    });

    it('should store error details in context', () => {
      const errorMessage = 'Test error message';
      const agentId = 'agent-1';
      const stage = 'impl';

      engine.transitionToError(errorMessage, agentId, stage);

      const context = engine.getContext();
      expect(context.error).toBeDefined();
      expect(context.error?.message).toBe(errorMessage);
      expect(context.error?.agentId).toBe(agentId);
      expect(context.error?.stage).toBe(stage);
      expect(context.error?.timestamp).toBeInstanceOf(Date);
    });

    it('should emit state:error event', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      engine.on('state:error', listener);

      engine.transitionToError('Test error', 'agent-1', 'test-stage');

      expect(listener).toHaveBeenCalledTimes(1);

      const event = listener.mock.calls[0]![0] as WorkflowEvent;
      expect(event.type).toBe('state:error');
    });

    it('should work from any state', () => {
      const states: WorkflowState[] = [
        'idle',
        'spec_pending',
        'arch_pending',
        'tests_pending',
        'impl_pending',
      ];

      for (const state of states) {
        const testEngine = new WorkflowEngine(`test-${state}`, 'Test prompt');

        if (state !== 'idle') {
          // Transition to the test state first
          const path = getPathToState(state);
          for (const s of path) {
            testEngine.transitionTo(s);
          }
        }

        testEngine.transitionToError('Error', 'agent', 'stage');
        expect(testEngine.getCurrentState()).toBe('error');
      }
    });
  });

  describe('event listeners', () => {
    it('should register event listener', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      engine.on('state:transition', listener);

      engine.transitionTo('spec_pending');

      expect(listener).toHaveBeenCalled();
    });

    it('should support multiple listeners for same event', () => {
      const listener1 = mock((_event: WorkflowEvent) => {});
      const listener2 = mock((_event: WorkflowEvent) => {});

      engine.on('state:transition', listener1);
      engine.on('state:transition', listener2);

      engine.transitionTo('spec_pending');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should support different event types', () => {
      const transitionListener = mock((_event: WorkflowEvent) => {});
      const errorListener = mock((_event: WorkflowEvent) => {});

      engine.on('state:transition', transitionListener);
      engine.on('state:error', errorListener);

      engine.transitionTo('spec_pending');
      expect(transitionListener).toHaveBeenCalledTimes(1);
      expect(errorListener).not.toHaveBeenCalled();

      engine.transitionToError('Error', 'agent', 'stage');
      expect(errorListener).toHaveBeenCalledTimes(1);
    });

    it('should unregister event listener', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      engine.on('state:transition', listener);

      engine.transitionTo('spec_pending');
      expect(listener).toHaveBeenCalledTimes(1);

      engine.off('state:transition', listener);

      engine.transitionTo('arch_pending');
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should handle listener errors gracefully', () => {
      const failingListener = mock((_event: WorkflowEvent) => {
        throw new Error('Listener error');
      });
      const workingListener = mock((_event: WorkflowEvent) => {});

      engine.on('state:transition', failingListener);
      engine.on('state:transition', workingListener);

      // Should not throw
      expect(() => {
        engine.transitionTo('spec_pending');
      }).not.toThrow();

      // Both listeners should have been called
      expect(failingListener).toHaveBeenCalled();
      expect(workingListener).toHaveBeenCalled();
    });

    it('should not emit events when no listeners registered', () => {
      // Should not throw
      expect(() => {
        engine.transitionTo('spec_pending');
      }).not.toThrow();
    });
  });

  describe('reset', () => {
    it('should reset to idle state', () => {
      engine.transitionTo('spec_pending');
      engine.transitionTo('arch_pending');

      engine.reset();

      expect(engine.getCurrentState()).toBe('idle');
    });

    it('should preserve feature name and initial prompt', () => {
      engine.reset();

      const context = engine.getContext();
      expect(context.featureName).toBe(featureName);
      expect(context.initialPrompt).toBe(initialPrompt);
    });

    it('should clear error', () => {
      engine.transitionToError('Error', 'agent', 'stage');

      engine.reset();

      const context = engine.getContext();
      expect(context.error).toBeUndefined();
    });

    it('should clear completedAt', () => {
      // Transition to complete
      engine.transitionTo('spec_pending');
      engine.transitionTo('arch_pending');
      engine.transitionTo('tests_pending');
      engine.transitionTo('impl_pending');
      engine.transitionTo('review_pending');
      engine.transitionTo('docs_pending');
      engine.transitionTo('complete');

      expect(engine.getContext().completedAt).toBeDefined();

      engine.reset();

      expect(engine.getContext().completedAt).toBeUndefined();
    });

    it('should set new startedAt timestamp', async () => {
      const originalContext = engine.getContext();
      const originalStartedAt = originalContext.startedAt;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      engine.reset();

      const newContext = engine.getContext();
      expect(newContext.startedAt.getTime()).toBeGreaterThan(originalStartedAt.getTime());
    });
  });
});

// Helper function to get path to a state
function getPathToState(targetState: WorkflowState): WorkflowState[] {
  const paths: Record<WorkflowState, WorkflowState[]> = {
    idle: [],
    spec_pending: ['spec_pending'],
    arch_pending: ['spec_pending', 'arch_pending'],
    tests_pending: ['spec_pending', 'arch_pending', 'tests_pending'],
    impl_pending: ['spec_pending', 'arch_pending', 'tests_pending', 'impl_pending'],
    review_pending: ['spec_pending', 'arch_pending', 'tests_pending', 'impl_pending', 'review_pending'],
    docs_pending: ['spec_pending', 'arch_pending', 'tests_pending', 'impl_pending', 'review_pending', 'docs_pending'],
    complete: ['spec_pending', 'arch_pending', 'tests_pending', 'impl_pending', 'review_pending', 'docs_pending', 'complete'],
    error: [], // Can transition from any state
  };

  return paths[targetState] ?? [];
}
