/**
 * Parse markdown files with YAML frontmatter
 */

import matter from 'gray-matter';
import { z } from 'zod';
import type { Artifact } from '../types/stage.types.js';

export const ArtifactMetadataSchema: z.ZodObject<{
  type: z.ZodEnum<['spec', 'architecture', 'task', 'test', 'implementation', 'review', 'documentation']>;
  from: z.ZodEnum<['product-manager', 'architect', 'test-engineer', 'developer', 'code-reviewer', 'documenter']>;
  to: z.ZodEnum<['product-manager', 'architect', 'test-engineer', 'developer', 'code-reviewer', 'documenter']>;
  status: z.ZodEnum<['pending', 'claimed', 'complete']>;
  claimedBy: z.ZodOptional<z.ZodString>;
  claimedAt: z.ZodOptional<z.ZodString>;
  priority: z.ZodOptional<z.ZodEnum<['high', 'normal', 'low']>>;
  featureName: z.ZodString;
  taskId: z.ZodOptional<z.ZodString>;
}> = z.object({
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

/**
 * Parse a markdown file with YAML frontmatter
 */
export function parseArtifact(filePath: string, content: string): Artifact {
  const { data, content: markdownContent } = matter(content);

  // Validate frontmatter
  const validated = ArtifactMetadataSchema.parse(data);

  return {
    path: filePath,
    frontmatter: validated as Artifact['frontmatter'],
    content: markdownContent,
  };
}

/**
 * Serialize an artifact to markdown with frontmatter
 */
export function serializeArtifact(artifact: Artifact): string {
  return matter.stringify(artifact.content, artifact.frontmatter);
}
