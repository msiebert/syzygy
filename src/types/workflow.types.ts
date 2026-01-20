/**
 * Workflow state types
 */

export type WorkflowState =
  | 'idle'
  | 'spec_pending'
  | 'arch_pending'
  | 'tests_pending'
  | 'impl_pending'
  | 'review_pending'
  | 'docs_pending'
  | 'complete'
  | 'error';

export interface WorkflowContext {
  featureName: string;
  state: WorkflowState;
  startedAt: Date;
  completedAt?: Date;
  error?: WorkflowError;
}

export interface WorkflowError {
  message: string;
  agentId: string;
  stage: string;
  context?: Record<string, unknown>;
  timestamp: Date;
}

export interface WorkflowMetrics {
  tasksCompleted: number;
  testsPassing: number;
  filesModified: number;
  duration: number; // milliseconds
}
