# Syzygy - Development Context for Claude Code

## Project Context

**Syzygy** is an orchestrator for multiple Claude Code instances running in tmux sessions, coordinating them through a shared file system to automate comprehensive, spec-driven development workflows.

### What Syzygy Is

- **Orchestrator**: A TypeScript/Bun application that coordinates multiple Claude Code agents
- **Not an agent itself**: Syzygy manages agents, it doesn't do the development work
- **Workflow engine**: Linear pipeline with parallel developers: PM → Arch → Test Eng → Dev(s) → Review → Docs
- **Communication hub**: Routes work through a shared file system using markdown files with YAML frontmatter

### What Syzygy Is Not

- Not a single Claude Code instance doing everything
- Not a message-passing system (no WebSockets, no queues)
- Not a microservices architecture
- Not a database-backed system

## Environment Setup

### Bun Runtime
This project uses Bun as its JavaScript/TypeScript runtime. Bun is installed at:
- **Path**: `~/.bun/bin/bun`
- **Full path**: `/Users/marksiebert/.bun/bin/bun`

To run bun commands:
```bash
~/.bun/bin/bun run dev        # Start development server
~/.bun/bin/bun run test       # Run tests
~/.bun/bin/bun run typecheck  # TypeScript check
~/.bun/bin/bun run build      # Build for production
```

Or use npx as fallback for TypeScript:
```bash
npx tsc --noEmit  # TypeScript check without bun
```

## Philosophy

### Core Principles

1. **Separation of concerns**: Each agent has one specialized role
2. **Tests-first**: All tests must exist before implementation begins
3. **Spec-driven**: Comprehensive specification before any code is written
4. **File-based simplicity**: No complex message buses, just files on disk
5. **Linear workflow**: Clear progression through stages with parallel developers
6. **User control**: Approval gates and immediate error escalation
7. **Clean sessions**: Always start fresh, kill all tmux sessions on exit

### Design Rationale

- **Tmux sessions**: Isolated environments for each agent, easy to monitor and control
- **Markdown files**: Human-readable, git-friendly, simple to parse
- **YAML frontmatter**: Structured metadata with free-form content
- **Lockfiles**: Simple concurrency control without databases
- **Polling**: Simple, reliable, no complex event systems
- **Stage directories**: Clear workflow progression, easy to understand state

## Development Guidelines

### Code Style

- **Strict TypeScript**: No `any`, no implicit types, 95%+ type coverage
- **Functional style**: Prefer pure functions, immutability, composition
- **Explicit error handling**: Typed errors with context, never swallow errors
- **No magic**: Prefer explicit over clever, readable over terse
- **Comments**: Only when code can't explain itself (complex algorithms, edge cases)

### TypeScript Configuration

```typescript
// All strict options enabled in tsconfig.json
// Key settings:
// - noImplicitAny: true
// - strictNullChecks: true
// - noUncheckedIndexedAccess: true
// - exactOptionalPropertyTypes: true
// - isolatedDeclarations: true (2026 best practice)
```

### Testing Strategy

- **TDD required**: Write failing test first, then implement
- **Minimum 90% coverage**: Enforced by bunfig.toml
- **Test types**:
  - **Unit tests**: Mock tmux, file system, test logic in isolation
  - **Integration tests**: Real tmux sessions, mock Claude responses (file-based fixtures)
  - **E2E tests**: Manual testing with real Claude instances
- **Test structure**: Arrange-Act-Assert pattern
- **Test naming**: `describe('Component', () => { it('should do X when Y', ...) })`

### Error Handling

- **Typed errors**: Create custom error classes extending `Error`
- **Context**: Include relevant data in error objects
- **User alerts**: Immediately notify user when agents fail
- **Graceful degradation**: Clean up tmux sessions in `finally` blocks
- **No silent failures**: Log everything, alert on failures

### Logging

- **Structured logging**: Use pino for JSON-formatted logs
- **Log levels**: debug, info, warn, error
- **Log locations**: `.syzygy/logs/[agent-name].log`
- **Log rotation**: Not implemented yet (future enhancement)
- **Development**: Pretty-print with pino-pretty

## Architecture Patterns

### Orchestrator Pattern

Syzygy coordinates all agents via tmux control:

```typescript
// Orchestrator responsibilities:
// 1. Create/destroy tmux sessions
// 2. Monitor agent progress (tmux pane capture)
// 3. Route instructions (tmux send-keys)
// 4. Display UI (split screen with Ink)
// 5. Handle errors (alert user, cleanup)
```

### File-Based Messaging

Markdown files flow through stage directories:

```
.syzygy/stages/
  spec/pending/     → Architect reads
  spec/done/        → Moved after processing
  arch/pending/     → Test Engineer reads
  arch/done/        → Moved after processing
  ...
```

### Lock-Based Concurrency

Simple file-based locks prevent race conditions:

```typescript
// Lock file format: task.md.lock
{
  "agentId": "dev-1",
  "claimedAt": "2026-01-16T10:30:00Z",
  "pid": 12345
}
```

### State Machine

Workflow engine tracks linear progression:

```typescript
type WorkflowState =
  | 'idle'
  | 'spec_pending'
  | 'arch_pending'
  | 'tests_pending'
  | 'impl_pending'
  | 'review_pending'
  | 'docs_pending'
  | 'complete'
  | 'error';
```

### Split Screen UI

Product Manager chat + Syzygy status:

```
┌─────────────────────────────────────────────┐
│ Product Manager Chat                        │
│                                             │
│ PM: What feature would you like to add?     │
│ You: I want user authentication             │
│ PM: What authentication method?             │
│ You: JWT tokens with refresh tokens         │
│                                             │
├─────────────────────────────────────────────┤
│ Syzygy Status                               │
│                                             │
│ ⚙️  PM: Writing spec... (90% complete)       │
│ ⏸️  Architect: Waiting for spec approval     │
│ ⏸️  Test Engineer: Waiting for architecture  │
│ ⏸️  Developer-1: Waiting for tasks           │
│                                             │
└─────────────────────────────────────────────┘
```

## Key Abstractions

### Agent

A Claude Code instance with a specific role running in a tmux session.

```typescript
interface Agent {
  id: string;              // "pm", "architect", "dev-1", etc.
  role: AgentRole;         // Enum: PM, Architect, TestEngineer, etc.
  sessionName: string;     // Tmux session name
  status: AgentStatus;     // idle, working, waiting, error
  currentTask?: string;    // Path to task file being processed
}

type AgentRole =
  | 'product-manager'
  | 'architect'
  | 'test-engineer'
  | 'developer'
  | 'code-reviewer'
  | 'documenter';

type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'error'
  | 'complete';
```

### Stage

A directory representing a workflow phase.

```typescript
interface Stage {
  name: string;           // "spec", "arch", "tasks", etc.
  pendingDir: string;     // ".syzygy/stages/spec/pending"
  doneDir: string;        // ".syzygy/stages/spec/done"
  inputRole: AgentRole;   // Agent that reads from this stage
  outputRole: AgentRole;  // Agent that writes to this stage
}
```

### Artifact

A markdown file containing work product.

```typescript
interface Artifact {
  path: string;           // Full path to file
  frontmatter: ArtifactMetadata;
  content: string;        // Markdown content body
}

interface ArtifactMetadata {
  type: ArtifactType;
  from: AgentRole;
  to: AgentRole;
  status: 'pending' | 'claimed' | 'complete';
  claimedBy?: string;
  claimedAt?: string;
  priority?: 'high' | 'normal' | 'low';
}

type ArtifactType =
  | 'spec'
  | 'architecture'
  | 'task'
  | 'test'
  | 'implementation'
  | 'review'
  | 'documentation';
```

### Session

A tmux session running a Claude Code instance.

```typescript
interface TmuxSession {
  name: string;           // Session name (unique)
  agentId: string;        // Associated agent ID
  windowId: string;       // Tmux window ID
  paneId: string;         // Tmux pane ID
  pid: number;            // Process ID
  createdAt: Date;
}
```

### Workspace

The `.syzygy/` directory in project root.

```typescript
interface Workspace {
  root: string;           // ".syzygy"
  stagesDir: string;      // ".syzygy/stages"
  logsDir: string;        // ".syzygy/logs"
  configPath: string;     // ".syzygy/config.json"
  stages: Stage[];        // All workflow stages
}
```

## Agent Roles & Responsibilities

### 1. Product Manager

**Role**: Interview user, write comprehensive specifications

**Input**: User conversation (split screen chat)

**Output**:
- `.syzygy/stages/spec/pending/[feature-name]-spec.md`

**Responsibilities**:
- Ask clarifying questions about requirements
- Identify edge cases and failure modes
- Define success criteria
- Write clear, comprehensive specs
- Get user approval before proceeding

**Success criteria**:
- User approves spec
- All requirements captured
- Edge cases identified
- Acceptance criteria defined

### 2. Architect

**Role**: Design system architecture, break work into tasks

**Input**:
- `.syzygy/stages/spec/done/[feature-name]-spec.md`

**Output**:
- `.syzygy/stages/arch/pending/[feature-name]-architecture.md`
- `.syzygy/stages/tasks/pending/[feature-name]-task-*.md`

**Responsibilities**:
- Design overall architecture
- Define APIs and interfaces
- Break work into human-sized tasks
- Specify dependencies between tasks
- Document architectural decisions

**Success criteria**:
- Architecture is complete and coherent
- Tasks are well-defined and independent
- Interfaces are clearly specified
- Dependencies are documented

### 3. Test Engineer

**Role**: Create comprehensive test suites before implementation

**Input**:
- `.syzygy/stages/spec/done/[feature-name]-spec.md`
- `.syzygy/stages/arch/done/[feature-name]-architecture.md`

**Output**:
- `.syzygy/stages/tests/pending/[feature-name]-tests.ts`

**Responsibilities**:
- Write tests that will fail initially (no implementation yet)
- Cover all acceptance criteria from spec
- Include unit and integration tests
- Test edge cases and error conditions
- Follow project testing conventions

**Success criteria**:
- All acceptance criteria have tests
- Edge cases are covered
- Tests are well-organized
- Tests fail before implementation (expected)

### 4. Developer

**Role**: Implement code to pass tests

**Input**:
- `.syzygy/stages/tasks/done/[feature-name]-task-*.md`
- `.syzygy/stages/tests/done/[feature-name]-tests.ts`
- `.syzygy/stages/arch/done/[feature-name]-architecture.md`
- `.syzygy/stages/spec/done/[feature-name]-spec.md`

**Output**:
- Modified/created source files
- `.syzygy/stages/impl/pending/[feature-name]-task-*-implementation.md`

**Responsibilities**:
- Read and understand task requirements
- Implement code according to architecture
- Run tests continuously until all pass
- Document implementation decisions
- Follow project code style

**Success criteria**:
- All tests pass
- Code follows architecture
- Implementation summary written
- No lint or type errors

### 5. Code Reviewer

**Role**: Review implementations for quality and correctness

**Input**:
- `.syzygy/stages/impl/done/[feature-name]-task-*-implementation.md`
- Source code files (listed in implementation summary)
- `.syzygy/stages/spec/done/[feature-name]-spec.md`

**Output**:
- `.syzygy/stages/review/pending/[feature-name]-task-*-review.md` (if approved)
- OR `.syzygy/stages/tasks/pending/[feature-name]-task-*-fixes.md` (if changes needed)

**Responsibilities**:
- Review code quality and maintainability
- Check adherence to spec and architecture
- Identify potential bugs or edge cases
- Look for security vulnerabilities
- Either approve or request specific fixes

**Success criteria**:
- Code meets quality standards
- No major issues found
- Security vulnerabilities addressed
- Spec requirements met

### 6. Documenter

**Role**: Update all project documentation

**Input**:
- All artifacts from completed workflow:
  - Spec, Architecture, Implementations, Reviews

**Output**:
- `.syzygy/stages/docs/pending/[feature-name]-documentation.md`
- Updated: `README.md`, `docs/api.md`, `docs/architecture.md`, etc.

**Responsibilities**:
- Update README if feature affects usage
- Document new APIs
- Update architecture diagrams
- Create migration guides if needed
- Ensure all changes are documented

**Success criteria**:
- All documentation is up-to-date
- APIs are documented
- User-facing changes in README
- Architecture diagrams updated

## Dependencies Rationale

### Core Dependencies

- **node-tmux** (^0.3.0): Lightweight tmux control wrapper
  - Direct access to tmux control mode
  - Promise-based API
  - Minimal abstractions

- **chalk** (^5.3.0): Terminal colorization for UI
  - Clean API for colored output
  - Widely used, well-maintained
  - No dependencies

- **zod** (^3.23.8): Runtime type validation
  - Validate markdown frontmatter
  - Type-safe parsing
  - Excellent TypeScript integration

- **pino** (^9.0.0): High-performance logging
  - Structured JSON logging
  - Low overhead
  - Child loggers for each agent

- **pino-pretty** (^11.0.0): Development log formatting
  - Human-readable logs in development
  - Disabled in production

- **chokidar** (^4.0.0): File system watching
  - Reliable cross-platform
  - Efficient polling
  - Debouncing support

- **ink** (^5.0.1): TUI framework
  - React-based (familiar mental model)
  - Component composition
  - Better than blessed for complex UIs

- **ink-spinner** (^5.0.0): Loading spinners for Ink
  - Visual feedback for long operations
  - Integrates seamlessly with Ink

- **react** (^18.3.1): Required by Ink
  - Ink dependency

- **gray-matter** (^4.0.3): Frontmatter parsing
  - Standard YAML frontmatter parser
  - Simple, reliable
  - Widely used in static site generators

### Dev Dependencies

- **@types/bun** (latest): TypeScript types for Bun
- **typescript** (^5.6.3): TypeScript compiler

## Artifact Flow

### Linear Progression

```
User → PM → Spec → Architect → Architecture + Tasks
                                     ↓
                              Test Engineer → Tests
                                     ↓
                              Developer(s) → Implementation
                                     ↓
                              Code Reviewer → Review
                                     ↓
                              Documenter → Documentation → Complete
```

### File Movement

Agents follow this pattern:

1. **Poll** their input stage's `pending/` directory
2. **Claim** a file by creating a `.lock` file
3. **Read** the claimed file and any referenced artifacts
4. **Process** the work according to their role
5. **Write** output files to next stage's `pending/` directory
6. **Move** input file from `pending/` to `done/`
7. **Release** lock file

### Lockfile Pattern

```typescript
// Example: Claiming a task
async function claimTask(taskPath: string, agentId: string): Promise<boolean> {
  const lockPath = `${taskPath}.lock`;

  try {
    // Attempt to create lock file (exclusive)
    await writeFile(lockPath, JSON.stringify({
      agentId,
      claimedAt: new Date().toISOString(),
      pid: process.pid
    }), { flag: 'wx' }); // 'wx' = create only if doesn't exist

    return true;
  } catch (err) {
    // Lock already exists, another agent claimed it
    return false;
  }
}

// Example: Releasing a lock
async function releaseLock(taskPath: string): Promise<void> {
  const lockPath = `${taskPath}.lock`;
  await unlink(lockPath).catch(() => {}); // Ignore errors if lock doesn't exist
}
```

## Message Format

All artifacts use this structure:

```markdown
---
type: task | spec | architecture | test | implementation | review | documentation
from: agent-role
to: agent-role
status: pending | claimed | complete
claimedBy: agent-id (optional)
claimedAt: timestamp (optional)
priority: high | normal | low
featureName: string
taskId: string (for tasks)
---

# [Title]

## Section 1
Content...

## Section 2
Content...
```

### Validation with Zod

```typescript
import { z } from 'zod';
import matter from 'gray-matter';

const ArtifactMetadataSchema = z.object({
  type: z.enum(['spec', 'architecture', 'task', 'test', 'implementation', 'review', 'documentation']),
  from: z.enum(['product-manager', 'architect', 'test-engineer', 'developer', 'code-reviewer', 'documenter']),
  to: z.enum(['product-manager', 'architect', 'test-engineer', 'developer', 'code-reviewer', 'documenter']),
  status: z.enum(['pending', 'claimed', 'complete']),
  claimedBy: z.string().optional(),
  claimedAt: z.string().optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  featureName: z.string(),
  taskId: z.string().optional(),
});

function parseArtifact(filePath: string): Artifact {
  const fileContent = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(fileContent);

  // Validate frontmatter
  const frontmatter = ArtifactMetadataSchema.parse(data);

  return {
    path: filePath,
    frontmatter,
    content,
  };
}
```

## Testing Strategy

### Unit Tests

**Mock external dependencies** (tmux, file system):

```typescript
// Example: Testing stage-manager
import { describe, it, expect, mock } from 'bun:test';
import { StageManager } from '@stages/stage-manager';

describe('StageManager', () => {
  it('should move artifact from pending to done', async () => {
    const mockFs = mock(() => ({
      readFile: mock(),
      writeFile: mock(),
      rename: mock(),
    }));

    const stageManager = new StageManager(mockFs);

    await stageManager.moveArtifact(
      'spec/pending/feature.md',
      'spec/done/feature.md'
    );

    expect(mockFs.rename).toHaveBeenCalledWith(
      '.syzygy/stages/spec/pending/feature.md',
      '.syzygy/stages/spec/done/feature.md'
    );
  });
});
```

### Integration Tests

**Real tmux sessions**, mock Claude responses:

```typescript
// Example: Testing orchestrator with real tmux
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Orchestrator } from '@core/orchestrator';
import { cleanupTmuxSessions } from '@utils/tmux-utils';

describe('Orchestrator (integration)', () => {
  beforeAll(async () => {
    await cleanupTmuxSessions(); // Clean slate
  });

  afterAll(async () => {
    await cleanupTmuxSessions(); // Cleanup
  });

  it('should create PM session and receive spec', async () => {
    const orchestrator = new Orchestrator();

    // Start workflow
    await orchestrator.startWorkflow('test-feature');

    // Inject mock spec (simulating PM writing it)
    await writeFile('.syzygy/stages/spec/pending/test-feature-spec.md', mockSpec);

    // Wait for architect to pick it up
    await waitFor(() =>
      exists('.syzygy/stages/arch/pending/test-feature-architecture.md')
    );

    expect(orchestrator.getWorkflowState()).toBe('arch_pending');
  });
});
```

### E2E Tests

**Manual testing** with real Claude instances:

```bash
# E2E test procedure:
# 1. Start syzygy in test project
# 2. Select "New Feature"
# 3. Chat with PM about simple feature (e.g., "add hello world endpoint")
# 4. Approve spec
# 5. Observe all agents working through stages
# 6. Verify completion notification
# 7. Check that tests pass and docs are updated
```

## Development Workflow

### Standard Workflow

1. **Write spec** in `docs/specs/`
2. **Generate types** from spec (manual process for now)
3. **Write failing test** in `tests/`
4. **Implement** in `src/`
5. **Run tests** until passing: `bun test`
6. **Type check**: `bun run typecheck`
7. **Integration test** (if applicable)
8. **Update documentation**

### Example: Adding a New Feature

```bash
# 1. Create spec
echo "# Feature: Lock Manager" > docs/specs/lock-manager.md

# 2. Write types
# Edit src/types/lock.types.ts

# 3. Write failing test
# Edit tests/unit/lock-manager.test.ts
bun test # Should fail

# 4. Implement
# Edit src/stages/lock-manager.ts
bun test # Should pass

# 5. Integration test
# Edit tests/integration/lock-manager.integration.test.ts
bun test

# 6. Type check
bun run typecheck

# 7. Update docs
# Edit CLAUDE.md or README.md
```

## Common Patterns

### Promise-Based APIs

All async operations return promises:

```typescript
// Good
async function createSession(agentId: string): Promise<TmuxSession> {
  // ...
}

// Bad
function createSession(agentId: string, callback: (session: TmuxSession) => void) {
  // Callbacks are harder to compose
}
```

### Zod Schema Validation

Validate all external data:

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  numDevelopers: z.number().min(1).max(10),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});

function loadConfig(path: string): Config {
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return ConfigSchema.parse(data); // Throws if invalid
}
```

### Typed Errors

Custom error classes with context:

```typescript
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// Usage
throw new AgentError(
  'Failed to claim task',
  'dev-1',
  { taskPath: '/path/to/task.md', reason: 'lock exists' }
);
```

### Cleanup in Finally Blocks

Always clean up tmux sessions:

```typescript
async function runWorkflow(): Promise<void> {
  const sessions: TmuxSession[] = [];

  try {
    sessions.push(await createSession('pm'));
    sessions.push(await createSession('architect'));

    // Do work...

  } finally {
    // Always cleanup, even on error
    await Promise.all(
      sessions.map(s => destroySession(s.name))
    );
  }
}
```

### Polling with Exponential Backoff

Monitor file system changes:

```typescript
async function pollForArtifact(
  path: string,
  maxAttempts = 10
): Promise<string | null> {
  let delay = 100; // Start with 100ms

  for (let i = 0; i < maxAttempts; i++) {
    if (await exists(path)) {
      return readFileSync(path, 'utf-8');
    }

    await sleep(delay);
    delay = Math.min(delay * 2, 5000); // Max 5s
  }

  return null; // Timeout
}
```

## Session Management

### Hybrid Approach

- **Core agents** (PM, Architect): Always running
- **Workers** (Developers, Reviewer, Documenter): Created on-demand
- **Default**: 1 developer session (configurable)

### Lifecycle

```typescript
// Startup
async function startup() {
  // 1. Clean up any existing sessions
  await cleanupAllSessions();

  // 2. Create core agents
  await createSession('pm');
  await createSession('architect');

  // 3. Workers created as needed
}

// Shutdown
async function shutdown() {
  // Always kill all sessions on exit
  await cleanupAllSessions();
}

// Cleanup function
async function cleanupAllSessions() {
  const sessions = await listSessions('syzygy-*');
  await Promise.all(sessions.map(s => killSession(s)));
}
```

## User Interaction Points

### 1. Startup Menu

```
Welcome to Syzygy

1. New Feature
2. Resume Workflow
3. Settings
4. Exit

Select option:
```

### 2. PM Interview (Split Screen)

Top half: Chat with Product Manager
Bottom half: Syzygy status (agent progress)

### 3. Spec Approval

```
Product Manager has finished the spec.

Preview:
---
[Spec content shown here]
---

Approve spec and begin work? (y/n):
```

### 4. Error Escalation

```
⚠️  ERROR: Developer-1 failed

Error: Cannot find module './auth.ts'

Actions:
1. View full error log
2. Retry task
3. Skip task
4. Abort workflow

Select action:
```

### 5. Completion Notification

```
✅ Workflow complete!

All tests passing: ✓
Documentation updated: ✓

Summary:
- 3 tasks completed
- 12 tests passing
- 4 files modified

View summary? (y/n):
```

## Next Steps

After foundation setup, implement in this order:

### Phase 1: Core Infrastructure (Week 1)
1. `tmux-utils.ts` - Basic tmux operations
2. `session-manager.ts` - Session lifecycle management
3. `stage-manager.ts` - Stage directory operations
4. `lock-manager.ts` - Lockfile concurrency control
5. `markdown-parser.ts` - Frontmatter + content parsing

### Phase 2: Agent System (Week 2)
1. `agent-config.ts` - Agent role definitions
2. `agent-instructions.ts` - Template instructions
3. `agent-runner.ts` - Send instructions to agents
4. `file-monitor.ts` - Watch stage directories

### Phase 3: Workflow Engine (Week 3)
1. `workflow-engine.ts` - State machine
2. `orchestrator.ts` - Main coordination logic
3. Type definitions for all abstractions

### Phase 4: User Interface (Week 4)
1. `menu.ts` - Interactive main menu
2. `split-screen.ts` - Ink-based split UI
3. `prompts.ts` - User input and approval gates
4. `index.ts` - CLI entry point

### Phase 5: Testing & Polish (Week 5)
1. Unit tests for all modules
2. Integration tests with real tmux
3. Example workflows
4. Documentation polish

## Immediate First Steps

1. Create directory structure
2. Write initial type definitions
3. Implement `tmux-utils.ts`
4. Write unit tests for `tmux-utils.ts`
5. Implement `stage-manager.ts`
6. Write unit tests for `stage-manager.ts`

---

This document is a living guide. Update it as the architecture evolves.
