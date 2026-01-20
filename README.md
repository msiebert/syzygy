# Syzygy

**Orchestrate multiple Claude Code instances for comprehensive, spec-driven development**

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Bun](https://img.shields.io/badge/bun-%3E%3D1.0.0-orange)

Syzygy coordinates multiple Claude Code agents through tmux to automate the complete development workflow from requirements gathering to documentation. Each agent has a specialized role, working together through a shared file system to deliver comprehensive, tested features.

## How It Works

Syzygy creates specialized Claude Code agents in separate tmux sessions. Each agent has a specific role in the development workflow:

- **Product Manager**: Interviews you to define requirements and writes comprehensive specs
- **Architect**: Designs system architecture and breaks work into tasks
- **Test Engineer**: Creates comprehensive test suites before implementation
- **Developer**: Implements features and ensures all tests pass
- **Code Reviewer**: Reviews implementations for quality and correctness
- **Documenter**: Updates all project documentation with changes

Agents communicate via shared markdown files in a staged workflow. You chat with the Product Manager to define requirements, then Syzygy orchestrates the rest automatically:

**Spec → Architecture → Tests → Implementation → Review → Documentation**

## Features

- **6 Specialized Agents**: PM, Architect, Test Engineer, Developer, Reviewer, Documenter working in harmony
- **Spec-Driven Workflow**: Requirements gathering produces a comprehensive spec before implementation begins
- **Test-First Development**: Tests are created before implementation and all must pass
- **Parallel Execution**: Multiple developers can work simultaneously on different tasks
- **Split Screen Interface**: Chat with the Product Manager while monitoring overall progress
- **File-Based Coordination**: Markdown files with YAML frontmatter flow through workflow stages
- **Interactive Mode**: Main menu, approval gates, and error notifications keep you in control

## Installation

### Prerequisites

- **Bun** (>= 1.0.0) - [Install Bun](https://bun.sh)
- **tmux** (>= 3.0) - `brew install tmux` (macOS) or `apt install tmux` (Linux)
- **Claude Code CLI** - Must be configured and authenticated

### Install Globally

```bash
bun install -g syzygy
```

### Or Clone and Run Locally

```bash
git clone https://github.com/marksiebert/syzygy
cd syzygy
bun install
bun run build
bun link
```

## Quick Start

```bash
# Navigate to your project directory
cd your-project

# Start syzygy
syzygy
```

Interactive menu appears:
1. **New Feature** - Start a new development workflow
2. **Resume Workflow** - Continue an existing workflow
3. **Settings** - Configure agent behavior and preferences
4. **Exit** - Clean up and exit

### Creating a New Feature

1. Select "New Feature" from the menu
2. Syzygy creates a Product Manager session in split screen
3. Chat with the PM to define your requirements
4. PM writes a comprehensive spec for your approval
5. Once approved, Syzygy automatically coordinates:
   - Architect designs the system and creates tasks
   - Test Engineer writes comprehensive tests
   - Developer(s) implement the code
   - Code Reviewer ensures quality
   - Documenter updates all docs
6. You receive a notification when all tests pass and the workflow is complete

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Syzygy Orchestrator                  │
│                  (TypeScript/Bun App)                   │
└─────────────────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼─────┐    ┌────▼─────┐    ┌────▼─────┐
    │ PM       │    │ Architect│    │ Test Eng │
    │ (tmux)   │    │ (tmux)   │    │ (tmux)   │
    └──────────┘    └──────────┘    └──────────┘
         │                │                │
         └────────────────┼────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼─────┐    ┌────▼─────┐    ┌────▼─────┐
    │ Dev-1    │    │ Reviewer │    │ Documenter│
    │ (tmux)   │    │ (tmux)   │    │ (tmux)   │
    └──────────┘    └──────────┘    └──────────┘
         │                │                │
         └────────────────▼────────────────┘
                          │
              ┌───────────▼───────────┐
              │ Shared File System    │
              │ (.syzygy/stages/)     │
              └───────────────────────┘
```

### Orchestrator Pattern

Syzygy is a **TypeScript/Bun application** that orchestrates multiple Claude Code instances. It is not itself an agent - it's the conductor managing the symphony:

- Creates and destroys tmux sessions for each agent role
- Monitors agent progress by capturing tmux pane output
- Routes instructions to agents via tmux stdin
- Provides interactive UI for user control
- Handles errors and alerts you immediately when agents get stuck

### Communication Model

Agents communicate through a **shared file system** using markdown files with YAML frontmatter:

```markdown
---
type: task
from: architect
to: developer
status: pending
priority: high
---

# Implement User Authentication

## Task Description
Create login endpoint with JWT token generation...

## Input Artifacts
- .syzygy/stages/spec/done/auth-spec.md
- .syzygy/stages/arch/done/auth-architecture.md

## Success Criteria
- All tests in auth-tests.ts pass
- JWT tokens expire after 24 hours
- Passwords are hashed with bcrypt
```

Files flow through **stages** in a linear pipeline:
1. **spec/** - Requirements and specifications
2. **arch/** - Architecture documents and task definitions
3. **tasks/** - Individual work items for developers
4. **tests/** - Test suites (created before implementation)
5. **impl/** - Implementation summaries
6. **review/** - Code review results
7. **docs/** - Documentation updates

Each stage has `pending/` and `done/` subdirectories. Agents claim work using `.lock` files.

## Workflow Stages

### 1. Spec
**Product Manager** interviews you in split screen chat, asking about requirements, edge cases, and success criteria. Produces a comprehensive specification document for your approval.

### 2. Architecture
**Architect** reads the approved spec and designs the system architecture. Defines APIs, interfaces, and breaks work into human-sized tasks.

### 3. Tests
**Test Engineer** creates comprehensive test cases based on the spec and architecture. Tests are written to fail initially (code doesn't exist yet). Covers all acceptance criteria and edge cases.

### 4. Implementation
**Developer(s)** read tasks and tests, then implement the code. Run tests continuously until all pass. Can work in parallel on different tasks.

### 5. Review
**Code Reviewer** examines implementations for major issues: code quality, adherence to spec, potential bugs, security vulnerabilities. Either approves or creates new tasks for fixes.

### 6. Documentation
**Documenter** updates all project documentation: README, API docs, architecture diagrams, etc. This is the final step before workflow completion.

## Configuration

Syzygy creates a `.syzygy/` workspace in your project root (auto-detected via git):

```
.syzygy/
├── stages/          # Workflow stages with pending/done subdirectories
│   ├── spec/
│   ├── arch/
│   ├── tasks/
│   ├── tests/
│   ├── impl/
│   ├── review/
│   └── docs/
├── logs/            # Agent session logs
│   ├── pm.log
│   ├── architect.log
│   ├── test-engineer.log
│   ├── dev-1.log
│   ├── reviewer.log
│   └── documenter.log
└── config.json      # Workspace configuration
```

### Settings

Access via main menu → Settings:

- **Number of Developers**: Default 1, increase for parallel work
- **Agent Instructions**: Customize prompts for each agent role
- **Session Lifecycle**: Clean start (default) vs. persistent sessions
- **Log Verbosity**: Control detail level in agent logs

## Requirements

- **Bun** >= 1.0.0
- **tmux** >= 3.0
- **Claude Code CLI** (authenticated)
- **Git repository** (for workspace detection)

## License

MIT - See [LICENSE](LICENSE) file for details

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Author

**Mark Siebert**

## Acknowledgments

Syzygy is inspired by the concept of celestial alignment - multiple bodies working in perfect harmony to achieve a greater purpose.
