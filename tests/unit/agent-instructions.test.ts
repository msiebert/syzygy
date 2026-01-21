/**
 * Unit tests for agent instruction generation
 */

import { describe, it, expect } from 'bun:test';
import {
  generatePMInstructions,
  generateArchitectInstructions,
  generateTestEngineerInstructions,
  generateDeveloperInstructions,
  generateReviewerInstructions,
  generateDocumenterInstructions,
  generateInstructions,
  type InstructionContext,
} from '../../src/agents/agent-instructions.js';
import type { AgentRole } from '../../src/types/agent.types.js';

describe('agent-instructions', () => {
  const baseContext: InstructionContext = {
    featureName: 'test-feature',
    specPath: '.syzygy/stages/spec/done/test-feature-spec.md',
    archPath: '.syzygy/stages/arch/done/test-feature-architecture.md',
    taskPath: '.syzygy/stages/tasks/pending/test-feature-task-1.md',
    testPath: '.syzygy/stages/tests/done/test-feature-tests.ts',
    implPath: '.syzygy/stages/impl/done/test-feature-task-1-implementation.md',
    reviewPath: '.syzygy/stages/review/done/test-feature-task-1-review.md',
    taskId: 'task-1',
  };

  describe('generatePMInstructions', () => {
    it('should generate instructions with feature name', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toContain('test-feature');
    });

    it('should include PM role description', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toContain('Product Manager');
      expect(instructions).toContain('multi-agent development workflow');
    });

    it('should specify output file path', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toContain('.syzygy/stages/spec/pending/test-feature-spec.md');
    });

    it('should include YAML frontmatter example', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toContain('---');
      expect(instructions).toContain('type: spec');
      expect(instructions).toContain('from: product-manager');
      expect(instructions).toContain('to: architect');
    });

    it('should list PM responsibilities', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toContain('clarifying questions');
      expect(instructions).toContain('edge cases');
      expect(instructions).toContain('success criteria');
      expect(instructions).toContain('specification');
    });

    it('should include spec structure requirements', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toContain('User Stories');
      expect(instructions).toContain('Acceptance Criteria');
      expect(instructions).toContain('Edge Cases');
      expect(instructions).toContain('Success Metrics');
    });
  });

  describe('generateArchitectInstructions', () => {
    it('should generate instructions with feature name', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('test-feature');
    });

    it('should include Architect role description', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('Architect');
    });

    it('should specify input spec file', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain(baseContext.specPath!);
    });

    it('should specify architecture output file', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('.syzygy/stages/arch/pending/test-feature-architecture.md');
    });

    it('should specify task output files', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('.syzygy/stages/tasks/pending/test-feature-task-');
    });

    it('should list Architect responsibilities', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('system architecture');
      expect(instructions).toContain('APIs and interfaces');
      expect(instructions).toContain('developer tasks');
      expect(instructions).toContain('dependencies');
    });

    it('should include architecture document structure', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('System Design');
      expect(instructions).toContain('Components');
      expect(instructions).toContain('APIs and Interfaces');
      expect(instructions).toContain('Architectural Decisions');
    });

    it('should include task file format', () => {
      const instructions = generateArchitectInstructions(baseContext);
      expect(instructions).toContain('type: task');
      expect(instructions).toContain('taskId');
      expect(instructions).toContain('dependencies');
    });
  });

  describe('generateTestEngineerInstructions', () => {
    it('should generate instructions with feature name', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain('test-feature');
    });

    it('should include Test Engineer role description', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain('Test Engineer');
    });

    it('should specify input files (spec and arch)', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain(baseContext.specPath!);
      expect(instructions).toContain(baseContext.archPath!);
    });

    it('should specify test output file', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain('.syzygy/stages/tests/pending/test-feature-tests.ts');
    });

    it('should emphasize TDD (tests fail before implementation)', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain('FAIL initially');
      expect(instructions).toContain('no implementation yet');
      expect(instructions).toContain('TDD');
    });

    it('should list test requirements', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain('acceptance criteria');
      expect(instructions).toContain('edge cases');
      expect(instructions).toContain('error conditions');
    });

    it('should include test format example', () => {
      const instructions = generateTestEngineerInstructions(baseContext);
      expect(instructions).toContain('describe');
      expect(instructions).toContain('it(');
      expect(instructions).toContain('expect(');
    });
  });

  describe('generateDeveloperInstructions', () => {
    it('should generate instructions with feature name and task ID', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('test-feature');
      expect(instructions).toContain('task-1');
    });

    it('should include Developer role description', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('Developer');
    });

    it('should specify all input files in order', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain(baseContext.taskPath!);
      expect(instructions).toContain(baseContext.testPath!);
      expect(instructions).toContain(baseContext.archPath!);
      expect(instructions).toContain(baseContext.specPath!);
    });

    it('should specify implementation output file', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('.syzygy/stages/impl/pending/test-feature-task-1-implementation.md');
    });

    it('should include implementation process steps', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('Read the task file');
      expect(instructions).toContain('Review the architecture');
      expect(instructions).toContain('Check the tests');
      expect(instructions).toContain('Implement');
      expect(instructions).toContain('Test continuously');
      expect(instructions).toContain('Type check');
    });

    it('should emphasize running tests', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('bun test');
      expect(instructions).toContain('bun run typecheck');
    });

    it('should include implementation summary format', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('type: implementation');
      expect(instructions).toContain('Files Modified/Created');
      expect(instructions).toContain('Test Results');
    });

    it('should instruct to move task file when done', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('mv');
      expect(instructions).toContain('done/');
    });
  });

  describe('generateReviewerInstructions', () => {
    it('should generate instructions with feature name and task ID', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain('test-feature');
      expect(instructions).toContain('task-1');
    });

    it('should include Code Reviewer role description', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain('Code Reviewer');
    });

    it('should specify input files', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain(baseContext.implPath!);
      expect(instructions).toContain(baseContext.specPath!);
    });

    it('should list review focus areas', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain('Code quality');
      expect(instructions).toContain('Spec adherence');
      expect(instructions).toContain('Edge cases');
      expect(instructions).toContain('Security');
      expect(instructions).toContain('Error handling');
      expect(instructions).toContain('Type safety');
    });

    it('should describe APPROVE option', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain('APPROVE');
      expect(instructions).toContain('.syzygy/stages/review/pending/');
      expect(instructions).toContain('approved: true');
    });

    it('should describe REQUEST CHANGES option', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain('REQUEST CHANGES');
      expect(instructions).toContain('fixes.md');
      expect(instructions).toContain('Issues Found');
    });

    it('should include format for fix tasks', () => {
      const instructions = generateReviewerInstructions(baseContext);
      expect(instructions).toContain('**Location**');
      expect(instructions).toContain('**Problem**');
      expect(instructions).toContain('**Required fix**');
    });
  });

  describe('generateDocumenterInstructions', () => {
    it('should generate instructions with feature name', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('test-feature');
    });

    it('should include Documenter role description', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('Documenter');
    });

    it('should specify input artifacts', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('Spec:');
      expect(instructions).toContain('Architecture:');
      expect(instructions).toContain('Implementations:');
      expect(instructions).toContain('Reviews:');
    });

    it('should list documentation responsibilities', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('README.md');
      expect(instructions).toContain('API');
      expect(instructions).toContain('architecture');
      expect(instructions).toContain('migration');
    });

    it('should specify output file', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('.syzygy/stages/docs/pending/test-feature-documentation.md');
    });

    it('should list files to update', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('README.md');
      expect(instructions).toContain('docs/api.md');
      expect(instructions).toContain('docs/architecture.md');
      expect(instructions).toContain('CHANGELOG.md');
    });

    it('should indicate workflow completion', () => {
      const instructions = generateDocumenterInstructions(baseContext);
      expect(instructions).toContain('workflow is finished');
      expect(instructions).toContain('notify the user');
    });
  });

  describe('generateInstructions', () => {
    it('should generate PM instructions for product-manager role', () => {
      const instructions = generateInstructions('product-manager', baseContext);
      expect(instructions).toContain('Product Manager');
    });

    it('should generate Architect instructions for architect role', () => {
      const instructions = generateInstructions('architect', baseContext);
      expect(instructions).toContain('Architect');
    });

    it('should generate Test Engineer instructions for test-engineer role', () => {
      const instructions = generateInstructions('test-engineer', baseContext);
      expect(instructions).toContain('Test Engineer');
    });

    it('should generate Developer instructions for developer role', () => {
      const instructions = generateInstructions('developer', baseContext);
      expect(instructions).toContain('Developer');
    });

    it('should generate Reviewer instructions for code-reviewer role', () => {
      const instructions = generateInstructions('code-reviewer', baseContext);
      expect(instructions).toContain('Code Reviewer');
    });

    it('should generate Documenter instructions for documenter role', () => {
      const instructions = generateInstructions('documenter', baseContext);
      expect(instructions).toContain('Documenter');
    });

    it('should throw for unknown role', () => {
      expect(() => generateInstructions('unknown' as AgentRole, baseContext)).toThrow('Unknown agent role');
    });

    it('should generate different instructions for each role', () => {
      const roles: AgentRole[] = [
        'product-manager',
        'architect',
        'test-engineer',
        'developer',
        'code-reviewer',
        'documenter',
      ];

      const instructions = roles.map(role => generateInstructions(role, baseContext));

      // Each should be unique
      const uniqueInstructions = new Set(instructions);
      expect(uniqueInstructions.size).toBe(6);
    });
  });

  describe('instruction context handling', () => {
    it('should handle minimal context for PM', () => {
      const minimalContext: InstructionContext = {
        featureName: 'minimal-feature',
      };

      const instructions = generatePMInstructions(minimalContext);
      expect(instructions).toContain('minimal-feature');
    });

    it('should use provided paths when available', () => {
      const customContext: InstructionContext = {
        featureName: 'custom',
        specPath: 'custom/path/spec.md',
        archPath: 'custom/path/arch.md',
      };

      const instructions = generateArchitectInstructions(customContext);
      expect(instructions).toContain('custom/path/spec.md');
    });

    it('should generate default paths when not provided', () => {
      const minimalContext: InstructionContext = {
        featureName: 'auto-path',
      };

      const instructions = generateArchitectInstructions(minimalContext);
      expect(instructions).toContain('.syzygy/stages/spec/done/auto-path-spec.md');
    });

    it('should handle task ID in developer instructions', () => {
      const context: InstructionContext = {
        featureName: 'test',
        taskId: 'custom-task-123',
      };

      const instructions = generateDeveloperInstructions(context);
      expect(instructions).toContain('custom-task-123');
    });
  });

  describe('instruction format validation', () => {
    it('should include markdown headings', () => {
      const instructions = generatePMInstructions(baseContext);
      expect(instructions).toMatch(/^#/m);
      expect(instructions).toMatch(/^##/m);
    });

    it('should include code blocks for examples', () => {
      const instructions = generateDeveloperInstructions(baseContext);
      expect(instructions).toContain('```');
    });

    it('should be non-empty for all roles', () => {
      const roles: AgentRole[] = [
        'product-manager',
        'architect',
        'test-engineer',
        'developer',
        'code-reviewer',
        'documenter',
      ];

      for (const role of roles) {
        const instructions = generateInstructions(role, baseContext);
        expect(instructions.length).toBeGreaterThan(100);
      }
    });
  });
});
