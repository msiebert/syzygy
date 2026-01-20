/**
 * Stage and artifact types
 */

import type { AgentRole } from './agent.types';

export type StageName =
  | 'spec'
  | 'arch'
  | 'tasks'
  | 'tests'
  | 'impl'
  | 'review'
  | 'docs';

export interface Stage {
  name: StageName;
  pendingDir: string;     // ".syzygy/stages/spec/pending"
  doneDir: string;        // ".syzygy/stages/spec/done"
  inputRole: AgentRole;   // Agent that reads from this stage
  outputRole: AgentRole;  // Agent that writes to this stage
}

export type ArtifactType =
  | 'spec'
  | 'architecture'
  | 'task'
  | 'test'
  | 'implementation'
  | 'review'
  | 'documentation';

export type ArtifactStatus = 'pending' | 'claimed' | 'complete';

export type ArtifactPriority = 'high' | 'normal' | 'low';

export interface ArtifactMetadata {
  type: ArtifactType;
  from: AgentRole;
  to: AgentRole;
  status: ArtifactStatus;
  claimedBy?: string;
  claimedAt?: string;
  priority?: ArtifactPriority;
  featureName: string;
  taskId?: string;
}

export interface Artifact {
  path: string;                    // Full path to file
  frontmatter: ArtifactMetadata;   // Parsed YAML frontmatter
  content: string;                 // Markdown content body
}
