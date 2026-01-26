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
  featureSlug: string;
  initialPrompt: string;
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

export type WorkflowEventType =
  | 'state:transition'
  | 'state:error'
  | 'artifact:created'
  | 'artifact:modified'
  | 'artifact:deleted'
  | 'artifact:claimed'
  | 'artifact:completed'
  | 'agent:started'
  | 'agent:completed'
  | 'agent:failed';

export interface WorkflowEvent {
  type: WorkflowEventType;
  timestamp: Date;
  payload: WorkflowEventPayload;
}

export type WorkflowEventPayload =
  | StateTransitionPayload
  | StateErrorPayload
  | ArtifactPayload
  | AgentPayload;

export interface StateTransitionPayload {
  from: WorkflowState;
  to: WorkflowState;
  featureName: string;
}

export interface StateErrorPayload {
  state: WorkflowState;
  error: WorkflowError;
}

export interface ArtifactPayload {
  artifactPath: string;
  stageName: string;
  agentId?: string;
}

export interface AgentPayload {
  agentId: string;
  role: string;
  error?: string;
}
