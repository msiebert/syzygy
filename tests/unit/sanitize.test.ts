/**
 * Unit tests for sanitization utilities
 */

import { describe, it, expect } from 'bun:test';
import {
  createSlug,
  validateFeatureName,
  sanitizeFeatureName,
  validateInitialPrompt,
  escapeShellArg,
} from '../../src/utils/sanitize';

describe('createSlug', () => {
  describe('stop word filtering', () => {
    it('should remove stop words from feature name', () => {
      const slug = createSlug('I want to add user authentication');
      expect(slug).toBe('add-user-authentication');
    });

    it('should handle multiple stop words', () => {
      const slug = createSlug('I want log messages to be output in their own section');
      expect(slug).toBe('log-messages-own-section');
    });

    it('should remove all articles and prepositions', () => {
      const slug = createSlug('A new feature for the system');
      expect(slug).toBe('new-feature-system');
    });
  });

  describe('special character removal', () => {
    it('should remove special characters', () => {
      const slug = createSlug('User Authentication & Authorization!');
      expect(slug).toBe('user-authentication-authorization');
    });

    it('should handle multiple special characters', () => {
      const slug = createSlug('Add @#$% dark mode toggle!!!');
      expect(slug).toBe('add-dark-mode-toggle');
    });

    it('should preserve hyphens', () => {
      const slug = createSlug('dark-mode-feature');
      expect(slug).toBe('dark-mode-feature');
    });
  });

  describe('length constraints', () => {
    it('should truncate long names at word boundary', () => {
      const longName = 'Add a really long feature name with many words that exceeds the fifty character limit';
      const slug = createSlug(longName);
      expect(slug.length).toBeLessThanOrEqual(50);
      expect(slug.endsWith('-')).toBe(false);
    });

    it('should handle names exactly at limit', () => {
      const slug = createSlug('This is exactly fifty characters long test');
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it('should preserve keyword extraction before truncation', () => {
      const slug = createSlug('Add dark mode toggle to settings panel interface');
      // Should extract keywords first, then truncate
      expect(slug.includes('dark')).toBe(true);
      expect(slug.includes('mode')).toBe(true);
    });
  });

  describe('fallback handling', () => {
    it('should fallback to normalized form if all words are stop words', () => {
      const slug = createSlug('I want to be the one');
      // All or most are stop words, should fallback to normalized
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).not.toContain(' ');
    });

    it('should handle empty string after filtering', () => {
      const slug = createSlug('a an the');
      expect(slug.length).toBeGreaterThan(0);
    });
  });

  describe('shell injection prevention', () => {
    it('should remove shell metacharacters', () => {
      const slug = createSlug('test; echo injection');
      expect(slug).not.toContain(';');
      expect(slug.includes('test')).toBe(true);
      expect(slug.includes('echo')).toBe(true);
    });

    it('should remove command substitution characters', () => {
      const slug = createSlug('test `whoami` command');
      expect(slug).not.toContain('`');
    });

    it('should remove pipe characters', () => {
      const slug = createSlug('test | grep password');
      expect(slug).not.toContain('|');
    });
  });

  describe('path traversal prevention', () => {
    it('should remove path traversal sequences', () => {
      const slug = createSlug('../../etc/passwd');
      expect(slug).not.toContain('..');
      expect(slug.includes('etc')).toBe(true);
    });

    it('should remove current directory references', () => {
      const slug = createSlug('./dangerous/path');
      expect(slug).not.toContain('./');
    });
  });

  describe('unicode handling', () => {
    it('should handle unicode characters', () => {
      const slug = createSlug('Add emoji 🎉 support');
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).not.toContain('🎉');
    });

    it('should handle accented characters', () => {
      const slug = createSlug('Café menu feature');
      expect(slug.length).toBeGreaterThan(0);
    });
  });

  describe('whitespace normalization', () => {
    it('should handle multiple spaces', () => {
      const slug = createSlug('feature   with   spaces');
      expect(slug).not.toContain('  ');
    });

    it('should trim leading and trailing whitespace', () => {
      const slug = createSlug('   feature name   ');
      expect(slug).not.toMatch(/^-|-$/);
    });

    it('should handle tabs and newlines', () => {
      const slug = createSlug('feature\twith\ttabs\nand\nnewlines');
      expect(slug.length).toBeGreaterThan(0);
    });
  });

  describe('case normalization', () => {
    it('should convert to lowercase', () => {
      const slug = createSlug('ADD USER AUTHENTICATION');
      expect(slug).toBe(slug.toLowerCase());
    });

    it('should handle mixed case', () => {
      const slug = createSlug('MyNewFeature');
      expect(slug).toBe('mynewfeature');
    });
  });

  describe('real-world examples', () => {
    it('should handle original failing case', () => {
      const slug = createSlug('I want log messages to be output in their own section');
      expect(slug).toBe('log-messages-own-section');
    });

    it('should handle auth feature', () => {
      const slug = createSlug('User Authentication & Authorization');
      expect(slug).toBe('user-authentication-authorization');
    });

    it('should handle dark mode feature', () => {
      const slug = createSlug('Add dark mode toggle to settings');
      expect(slug.includes('dark')).toBe(true);
      expect(slug.includes('mode')).toBe(true);
      expect(slug.includes('toggle')).toBe(true);
    });

    it('should handle complex e-commerce feature', () => {
      const slug = createSlug('Create a shopping cart with checkout & payment processing');
      expect(slug.includes('shopping')).toBe(true);
      expect(slug.includes('cart')).toBe(true);
    });
  });
});

describe('validateFeatureName', () => {
  describe('empty/whitespace validation', () => {
    it('should reject empty string', () => {
      const result = validateFeatureName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject whitespace-only string', () => {
      const result = validateFeatureName('   ');
      expect(result.valid).toBe(false);
    });

    it('should reject null/undefined', () => {
      const result = validateFeatureName('');
      expect(result.valid).toBe(false);
    });
  });

  describe('length constraints', () => {
    it('should reject names under 3 characters', () => {
      const result = validateFeatureName('ab');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('3 characters');
    });

    it('should accept names with 3 characters', () => {
      const result = validateFeatureName('abc');
      expect(result.valid).toBe(true);
    });

    it('should reject names over 100 characters', () => {
      const longName = 'a'.repeat(101);
      const result = validateFeatureName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('100');
    });

    it('should accept names with 100 characters', () => {
      const longName = 'a'.repeat(100);
      const result = validateFeatureName(longName);
      expect(result.valid).toBe(true);
    });
  });

  describe('path traversal detection', () => {
    it('should reject ../ sequences', () => {
      const result = validateFeatureName('../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject ./ sequences', () => {
      const result = validateFeatureName('./dangerous/path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should allow normal dots in names', () => {
      const result = validateFeatureName('add.feature.here');
      expect(result.valid).toBe(true);
    });
  });

  describe('control character detection', () => {
    it('should reject null bytes', () => {
      const result = validateFeatureName('feature\x00name');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('control');
    });

    it('should reject other control characters', () => {
      const result = validateFeatureName('feature\x01name');
      expect(result.valid).toBe(false);
    });

    it('should allow tabs in names', () => {
      const result = validateFeatureName('feature\tname');
      expect(result.valid).toBe(true);
    });

    it('should allow newlines in names', () => {
      const result = validateFeatureName('feature\nname');
      expect(result.valid).toBe(true);
    });
  });

  describe('valid inputs', () => {
    it('should accept normal feature names', () => {
      const result = validateFeatureName('Add user authentication');
      expect(result.valid).toBe(true);
    });

    it('should accept names with special characters', () => {
      const result = validateFeatureName('User Auth & Authorization!');
      expect(result.valid).toBe(true);
    });

    it('should accept names with numbers', () => {
      const result = validateFeatureName('Add OAuth 2.0 support');
      expect(result.valid).toBe(true);
    });

    it('should accept names with hyphens', () => {
      const result = validateFeatureName('Add dark-mode toggle');
      expect(result.valid).toBe(true);
    });
  });
});

describe('validateInitialPrompt', () => {
  describe('empty/whitespace validation', () => {
    it('should reject empty string', () => {
      const result = validateInitialPrompt('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject whitespace-only string', () => {
      const result = validateInitialPrompt('   ');
      expect(result.valid).toBe(false);
    });
  });

  describe('length constraints', () => {
    it('should reject prompts under 10 characters', () => {
      const result = validateInitialPrompt('short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('10 characters');
    });

    it('should accept prompts with 10 characters', () => {
      const result = validateInitialPrompt('0123456789');
      expect(result.valid).toBe(true);
    });

    it('should reject prompts over 500 characters', () => {
      const longPrompt = 'a'.repeat(501);
      const result = validateInitialPrompt(longPrompt);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should accept prompts with 500 characters', () => {
      const longPrompt = 'a'.repeat(500);
      const result = validateInitialPrompt(longPrompt);
      expect(result.valid).toBe(true);
    });
  });

  describe('path traversal detection', () => {
    it('should reject ../ sequences', () => {
      const result = validateInitialPrompt('Test description ../path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject ./ sequences', () => {
      const result = validateInitialPrompt('Test description ./dangerous');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should allow normal dots in descriptions', () => {
      const result = validateInitialPrompt('Test description with... dots');
      expect(result.valid).toBe(true);
    });
  });

  describe('control character detection', () => {
    it('should reject null bytes', () => {
      const result = validateInitialPrompt('Test description\x00here');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('control');
    });

    it('should reject other control characters', () => {
      const result = validateInitialPrompt('Test description\x01here');
      expect(result.valid).toBe(false);
    });

    it('should allow tabs in prompts', () => {
      const result = validateInitialPrompt('Test\tdescription\there');
      expect(result.valid).toBe(true);
    });

    it('should allow newlines in prompts', () => {
      const result = validateInitialPrompt('Test\ndescription\nhere');
      expect(result.valid).toBe(true);
    });
  });

  describe('valid inputs', () => {
    it('should accept normal descriptions', () => {
      const result = validateInitialPrompt('I want JWT-based authentication with OAuth support');
      expect(result.valid).toBe(true);
    });

    it('should accept descriptions with special characters', () => {
      const result = validateInitialPrompt('Add OAuth 2.0 & SAML support with @ symbols');
      expect(result.valid).toBe(true);
    });

    it('should accept descriptions with punctuation', () => {
      const result = validateInitialPrompt('Create a feature. It should do X, Y, and Z!');
      expect(result.valid).toBe(true);
    });

    it('should accept descriptions with numbers', () => {
      const result = validateInitialPrompt('Add support for 256-bit encryption with SHA512 hashing');
      expect(result.valid).toBe(true);
    });

    it('should accept descriptions with parentheses', () => {
      const result = validateInitialPrompt('Implement WebSocket (real-time) notifications (optional)');
      expect(result.valid).toBe(true);
    });

    it('should accept descriptions with quotes', () => {
      const result = validateInitialPrompt('Add "dark mode" toggle and \'light mode\' support');
      expect(result.valid).toBe(true);
    });
  });

  describe('real-world examples', () => {
    it('should accept JWT auth description', () => {
      const result = validateInitialPrompt('I want JWT-based authentication with refresh tokens and OAuth support for Google and GitHub');
      expect(result.valid).toBe(true);
    });

    it('should accept e-commerce description', () => {
      const result = validateInitialPrompt('Build a shopping cart with inventory tracking, multiple payment methods, and order history');
      expect(result.valid).toBe(true);
    });

    it('should accept API description', () => {
      const result = validateInitialPrompt('Create REST API endpoints for user management with role-based access control (RBAC)');
      expect(result.valid).toBe(true);
    });
  });
});

describe('sanitizeFeatureName', () => {
  it('should preserve normal text', () => {
    const sanitized = sanitizeFeatureName('Add user authentication');
    expect(sanitized).toBe('Add user authentication');
  });

  it('should remove null bytes', () => {
    const sanitized = sanitizeFeatureName('feature\x00name');
    expect(sanitized).not.toContain('\x00');
  });

  it('should remove control characters', () => {
    const sanitized = sanitizeFeatureName('feature\x01\x02name');
    expect(sanitized).toBe('featurename');
  });

  it('should preserve special characters that are safe', () => {
    const sanitized = sanitizeFeatureName('Feature & Authorization!');
    expect(sanitized).toBe('Feature & Authorization!');
  });

  it('should preserve unicode characters', () => {
    const sanitized = sanitizeFeatureName('Feature 🎉 emoji');
    expect(sanitized).toBe('Feature 🎉 emoji');
  });
});

describe('escapeShellArg', () => {
  describe('safe characters', () => {
    it('should not escape alphanumeric characters', () => {
      const escaped = escapeShellArg('test123');
      expect(escaped).toBe('test123');
    });

    it('should not escape underscore', () => {
      const escaped = escapeShellArg('test_feature');
      expect(escaped).toBe('test_feature');
    });

    it('should not escape hyphen', () => {
      const escaped = escapeShellArg('test-feature');
      expect(escaped).toBe('test-feature');
    });

    it('should not escape forward slash', () => {
      const escaped = escapeShellArg('path/to/file');
      expect(escaped).toBe('path/to/file');
    });

    it('should not escape dot', () => {
      const escaped = escapeShellArg('file.txt');
      expect(escaped).toBe('file.txt');
    });
  });

  describe('spaces and special characters', () => {
    it('should escape strings with spaces', () => {
      const escaped = escapeShellArg('test feature');
      expect(escaped).toBe("'test feature'");
    });

    it('should escape strings with special shell characters', () => {
      const escaped = escapeShellArg('test; echo injection');
      expect(escaped.includes("'")).toBe(true);
    });

    it('should handle single quotes by escaping them', () => {
      const escaped = escapeShellArg("test'quote");
      expect(escaped).toContain("\\'");
    });

    it('should escape backticks', () => {
      const escaped = escapeShellArg('test `command`');
      expect(escaped.includes("'")).toBe(true);
    });

    it('should escape pipes', () => {
      const escaped = escapeShellArg('test | grep');
      expect(escaped.includes("'")).toBe(true);
    });

    it('should escape redirects', () => {
      const escaped = escapeShellArg('test > file.txt');
      expect(escaped.includes("'")).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const escaped = escapeShellArg('');
      expect(escaped).toBe("''");
    });

    it('should handle string with only single quote', () => {
      const escaped = escapeShellArg("'");
      expect(escaped.includes("'")).toBe(true);
    });

    it('should handle multiple single quotes', () => {
      const escaped = escapeShellArg("test''quote''here");
      expect(escaped.includes("\\'")).toBe(true);
    });

    it('should handle complex shell command', () => {
      const arg = "test; rm -rf /; echo 'injection'";
      const escaped = escapeShellArg(arg);
      expect(escaped).toBe("'test; rm -rf /; echo '\\'''injection'\\'''");
    });
  });

  describe('real-world usage', () => {
    it('should escape session IDs with spaces', () => {
      const sessionId = 'syzygy-test feature-pm';
      const escaped = escapeShellArg(sessionId);
      expect(escaped.includes("'")).toBe(true);
    });

    it('should escape file paths with special characters', () => {
      const path = '.syzygy/stages/spec/pending/test feature-spec.md';
      const escaped = escapeShellArg(path);
      expect(escaped.includes("'")).toBe(true);
    });
  });
});
