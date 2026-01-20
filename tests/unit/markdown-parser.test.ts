/**
 * Unit tests for markdown-parser
 */

import { describe, it, expect } from 'bun:test';
import { parseArtifact, serializeArtifact, ArtifactMetadataSchema } from '../../src/utils/markdown-parser.js';
import type { Artifact } from '../../src/types/stage.types.js';

describe('markdown-parser', () => {
  describe('parseArtifact', () => {
    it('should parse valid artifact with frontmatter', () => {
      const content = `---
type: spec
from: product-manager
to: architect
status: pending
featureName: test-feature
---

# Test Feature

This is a test feature specification.

## Requirements

- Requirement 1
- Requirement 2
`;

      const artifact = parseArtifact('/path/to/artifact.md', content);

      expect(artifact.path).toBe('/path/to/artifact.md');
      expect(artifact.frontmatter.type).toBe('spec');
      expect(artifact.frontmatter.from).toBe('product-manager');
      expect(artifact.frontmatter.to).toBe('architect');
      expect(artifact.frontmatter.status).toBe('pending');
      expect(artifact.frontmatter.featureName).toBe('test-feature');
      expect(artifact.content).toContain('# Test Feature');
      expect(artifact.content).toContain('## Requirements');
    });

    it('should parse artifact with optional fields', () => {
      const content = `---
type: task
from: architect
to: developer
status: claimed
claimedBy: dev-1
claimedAt: '2026-01-16T10:00:00Z'
priority: high
featureName: auth-feature
taskId: auth-task-1
---

# Task Content
`;

      const artifact = parseArtifact('/path/to/task.md', content);

      expect(artifact.frontmatter.claimedBy).toBe('dev-1');
      expect(artifact.frontmatter.claimedAt).toBe('2026-01-16T10:00:00Z');
      expect(artifact.frontmatter.priority).toBe('high');
      expect(artifact.frontmatter.taskId).toBe('auth-task-1');
    });

    it('should throw error for invalid artifact type', () => {
      const content = `---
type: invalid-type
from: product-manager
to: architect
status: pending
featureName: test
---

Content
`;

      expect(() => parseArtifact('/path/to/artifact.md', content)).toThrow();
    });

    it('should throw error for invalid agent role', () => {
      const content = `---
type: spec
from: invalid-role
to: architect
status: pending
featureName: test
---

Content
`;

      expect(() => parseArtifact('/path/to/artifact.md', content)).toThrow();
    });

    it('should throw error for missing required fields', () => {
      const content = `---
type: spec
from: product-manager
---

Content
`;

      expect(() => parseArtifact('/path/to/artifact.md', content)).toThrow();
    });

    it('should parse artifact with empty content', () => {
      const content = `---
type: spec
from: product-manager
to: architect
status: pending
featureName: test
---
`;

      const artifact = parseArtifact('/path/to/artifact.md', content);

      expect(artifact.content.trim()).toBe('');
    });

    it('should handle multiline frontmatter values', () => {
      const content = `---
type: spec
from: product-manager
to: architect
status: pending
featureName: test-feature
---

Content here
`;

      const artifact = parseArtifact('/path/to/artifact.md', content);

      expect(artifact.frontmatter.featureName).toBe('test-feature');
    });
  });

  describe('serializeArtifact', () => {
    it('should serialize artifact to markdown with frontmatter', () => {
      const artifact: Artifact = {
        path: '/path/to/artifact.md',
        frontmatter: {
          type: 'spec',
          from: 'product-manager',
          to: 'architect',
          status: 'pending',
          featureName: 'test-feature',
        },
        content: '# Test Feature\n\nThis is the content.',
      };

      const serialized = serializeArtifact(artifact);

      expect(serialized).toContain('---');
      expect(serialized).toContain('type: spec');
      expect(serialized).toContain('from: product-manager');
      expect(serialized).toContain('to: architect');
      expect(serialized).toContain('status: pending');
      expect(serialized).toContain('featureName: test-feature');
      expect(serialized).toContain('# Test Feature');
      expect(serialized).toContain('This is the content.');
    });

    it('should serialize artifact with optional fields', () => {
      const artifact: Artifact = {
        path: '/path/to/task.md',
        frontmatter: {
          type: 'task',
          from: 'architect',
          to: 'developer',
          status: 'claimed',
          claimedBy: 'dev-1',
          claimedAt: '2026-01-16T10:00:00Z',
          priority: 'high',
          featureName: 'auth',
          taskId: 'task-1',
        },
        content: 'Task content',
      };

      const serialized = serializeArtifact(artifact);

      expect(serialized).toContain('claimedBy: dev-1');
      expect(serialized).toMatch(/claimedAt:.*2026-01-16T10:00:00Z/);
      expect(serialized).toContain('priority: high');
      expect(serialized).toContain('taskId: task-1');
    });

    it('should round-trip parse and serialize', () => {
      const original = `---
type: spec
from: product-manager
to: architect
status: pending
featureName: round-trip-test
priority: normal
---

# Original Content

This should survive a round trip.
`;

      const parsed = parseArtifact('/path/to/test.md', original);
      const serialized = serializeArtifact(parsed);
      const reparsed = parseArtifact('/path/to/test.md', serialized);

      expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
      expect(reparsed.content.trim()).toBe(parsed.content.trim());
    });
  });

  describe('ArtifactMetadataSchema', () => {
    it('should validate all artifact types', () => {
      const types = ['spec', 'architecture', 'task', 'test', 'implementation', 'review', 'documentation'];

      for (const type of types) {
        const metadata = {
          type,
          from: 'product-manager',
          to: 'architect',
          status: 'pending',
          featureName: 'test',
        };

        expect(() => ArtifactMetadataSchema.parse(metadata)).not.toThrow();
      }
    });

    it('should validate all agent roles', () => {
      const roles = ['product-manager', 'architect', 'test-engineer', 'developer', 'code-reviewer', 'documenter'];

      for (const role of roles) {
        const metadata = {
          type: 'spec',
          from: role,
          to: role,
          status: 'pending',
          featureName: 'test',
        };

        expect(() => ArtifactMetadataSchema.parse(metadata)).not.toThrow();
      }
    });

    it('should validate all status values', () => {
      const statuses = ['pending', 'claimed', 'complete'];

      for (const status of statuses) {
        const metadata = {
          type: 'spec',
          from: 'product-manager',
          to: 'architect',
          status,
          featureName: 'test',
        };

        expect(() => ArtifactMetadataSchema.parse(metadata)).not.toThrow();
      }
    });

    it('should validate all priority values', () => {
      const priorities = ['high', 'normal', 'low'];

      for (const priority of priorities) {
        const metadata = {
          type: 'spec',
          from: 'product-manager',
          to: 'architect',
          status: 'pending',
          featureName: 'test',
          priority,
        };

        expect(() => ArtifactMetadataSchema.parse(metadata)).not.toThrow();
      }
    });

    it('should reject invalid priority', () => {
      const metadata = {
        type: 'spec',
        from: 'product-manager',
        to: 'architect',
        status: 'pending',
        featureName: 'test',
        priority: 'urgent',
      };

      expect(() => ArtifactMetadataSchema.parse(metadata)).toThrow();
    });
  });
});
