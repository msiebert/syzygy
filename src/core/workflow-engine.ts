/**
 * Workflow state machine
 */

import type {
  WorkflowState,
  WorkflowContext,
  WorkflowEvent,
  WorkflowEventType,
  StateTransitionPayload,
  StateErrorPayload,
} from '../types/workflow.types.js';
import { WorkflowEngineError } from '../types/message.types.js';
import { createModuleLogger } from '@utils/logger';

const logger = createModuleLogger('workflow-engine');

type EventListener = (event: WorkflowEvent) => void;

/**
 * Valid state transitions in the workflow
 */
const VALID_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  idle: ['spec_pending', 'error'],
  spec_pending: ['arch_pending', 'error'],
  arch_pending: ['tests_pending', 'error'],
  tests_pending: ['impl_pending', 'error'],
  impl_pending: ['review_pending', 'error'],
  review_pending: ['docs_pending', 'impl_pending', 'error'], // Can loop back for fixes
  docs_pending: ['complete', 'error'],
  complete: ['idle'], // Can start new workflow
  error: ['idle'], // Can retry from error
};

export class WorkflowEngine {
  private context: WorkflowContext;
  private listeners: Map<WorkflowEventType, EventListener[]> = new Map();

  constructor(featureName: string) {
    this.context = {
      featureName,
      state: 'idle',
      startedAt: new Date(),
    };

    logger.info({ featureName }, 'Workflow engine initialized');
  }

  /**
   * Get current workflow state
   */
  getCurrentState(): WorkflowState {
    return this.context.state;
  }

  /**
   * Get full workflow context
   */
  getContext(): WorkflowContext {
    return { ...this.context };
  }

  /**
   * Get feature name
   */
  getFeatureName(): string {
    return this.context.featureName;
  }

  /**
   * Check if a transition is valid
   */
  canTransition(to: WorkflowState): boolean {
    const validStates = VALID_TRANSITIONS[this.context.state];
    return validStates !== undefined && validStates.includes(to);
  }

  /**
   * Transition to a new state
   */
  transitionTo(to: WorkflowState): void {
    const from = this.context.state;

    logger.info({ from, to, featureName: this.context.featureName }, 'Attempting state transition');

    if (!this.canTransition(to)) {
      const error = new WorkflowEngineError(
        `Invalid transition from ${from} to ${to}`,
        from,
        to,
        { validStates: VALID_TRANSITIONS[from] }
      );

      logger.error(
        { from, to, validStates: VALID_TRANSITIONS[from] },
        'Invalid state transition'
      );

      throw error;
    }

    // Update state
    this.context.state = to;

    // Set completion time if we reached complete state
    if (to === 'complete') {
      this.context.completedAt = new Date();
    }

    logger.info(
      { from, to, featureName: this.context.featureName },
      'State transition successful'
    );

    // Emit transition event
    const payload: StateTransitionPayload = {
      from,
      to,
      featureName: this.context.featureName,
    };

    this.emit({
      type: 'state:transition',
      timestamp: new Date(),
      payload,
    });
  }

  /**
   * Transition to error state with error details
   */
  transitionToError(errorMessage: string, agentId: string, stage: string): void {
    const currentState = this.context.state;

    // Update context with error
    this.context.state = 'error';
    this.context.error = {
      message: errorMessage,
      agentId,
      stage,
      timestamp: new Date(),
    };

    logger.error(
      { errorMessage, agentId, stage, previousState: currentState },
      'Workflow transitioned to error state'
    );

    // Emit error event
    const payload: StateErrorPayload = {
      state: currentState,
      error: this.context.error,
    };

    this.emit({
      type: 'state:error',
      timestamp: new Date(),
      payload,
    });
  }

  /**
   * Register an event listener
   */
  on(eventType: WorkflowEventType, listener: EventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    this.listeners.get(eventType)!.push(listener);

    logger.debug({ eventType }, 'Event listener registered');
  }

  /**
   * Unregister an event listener
   */
  off(eventType: WorkflowEventType, listener: EventListener): void {
    const listeners = this.listeners.get(eventType);

    if (!listeners) {
      return;
    }

    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
      logger.debug({ eventType }, 'Event listener unregistered');
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit(event: WorkflowEvent): void {
    const listeners = this.listeners.get(event.type);

    if (!listeners || listeners.length === 0) {
      logger.debug({ eventType: event.type }, 'No listeners for event');
      return;
    }

    logger.debug(
      { eventType: event.type, listenerCount: listeners.length },
      'Emitting event to listeners'
    );

    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error(
          { eventType: event.type, error },
          'Error in event listener'
        );
      }
    }
  }

  /**
   * Reset workflow to idle state
   */
  reset(): void {
    logger.info({ featureName: this.context.featureName }, 'Resetting workflow');

    this.context = {
      featureName: this.context.featureName,
      state: 'idle',
      startedAt: new Date(),
    };
  }
}
