/**
 * Sanitization utilities for feature names and identifiers
 * Provides slug generation, validation, and shell escaping
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Create a URL-safe slug from a feature name using keyword extraction
 * Removes common words, special characters, and ensures length constraints
 *
 * Examples:
 * - "I want log messages to be output in their own section" → "log-messages-own-section"
 * - "User Authentication & Authorization" → "user-authentication-authorization"
 * - "Add dark mode toggle to settings" → "add-dark-mode-toggle-settings"
 */
export function createSlug(name: string): string {
  // 1. Normalize: lowercase, trim, remove non-word characters except spaces/hyphens
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '');

  // 2. Split into words
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);

  // 3. Filter out common stop words
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'he',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'that',
    'the',
    'to',
    'was',
    'will',
    'with',
    'i',
    'want',
    'would',
    'like',
    'their',
    'output',
    'interspersed',
  ]);

  const keywords = words.filter((w) => w.length > 0 && !stopWords.has(w));

  // 4. Join with hyphens and limit to 50 chars at word boundary
  let slug = keywords.join('-');
  if (slug.length > 50) {
    // Truncate at word boundary
    slug = slug.substring(0, 50).replace(/-[^-]*$/, '');
  }

  // 5. Fallback if empty after filtering (all stop words)
  if (slug.length === 0) {
    slug = normalized.replace(/\s+/g, '-').substring(0, 50);
  }

  // 6. Remove leading/trailing hyphens
  return slug.replace(/^-|-$/g, '');
}

/**
 * Validate a feature name for safety and usability
 * Checks length, path traversal, control characters, etc.
 */
export function validateFeatureName(name: string): ValidationResult {
  // Check if empty or whitespace only
  if (!name || !name.trim()) {
    return { valid: false, error: 'Feature name cannot be empty' };
  }

  // Check length
  if (name.length < 3) {
    return {
      valid: false,
      error: 'Feature name must be at least 3 characters',
    };
  }

  if (name.length > 100) {
    return {
      valid: false,
      error: 'Feature name cannot exceed 100 characters',
    };
  }

  // Check for path traversal attempts
  if (name.includes('../') || name.includes('./')) {
    return {
      valid: false,
      error: 'Feature name cannot contain path traversal sequences',
    };
  }

  // Check for null bytes and control characters
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    // Null byte (0) or other control characters (0-31, 127)
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      return {
        valid: false,
        error: 'Feature name contains invalid control characters',
      };
    }
  }

  return { valid: true };
}

/**
 * Sanitize a feature name for storage in metadata/display
 * Removes potentially problematic characters while preserving readability
 */
export function sanitizeFeatureName(name: string): string {
  // Remove null bytes and control characters
  return name
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      // Keep normal characters, allow tabs/newlines/carriage returns if needed
      return code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
        ? false
        : true;
    })
    .join('');
}

/**
 * Validate an initial prompt/description for safety and usability
 * More lenient than feature name validation to allow full descriptions
 */
export function validateInitialPrompt(prompt: string): ValidationResult {
  // Check if empty or whitespace only
  if (!prompt || !prompt.trim()) {
    return { valid: false, error: 'Description cannot be empty' };
  }

  // Check length
  if (prompt.trim().length < 10) {
    return {
      valid: false,
      error: 'Description must be at least 10 characters',
    };
  }

  if (prompt.length > 500) {
    return {
      valid: false,
      error: 'Description cannot exceed 500 characters',
    };
  }

  // Check for path traversal attempts
  if (prompt.includes('../') || prompt.includes('./')) {
    return {
      valid: false,
      error: 'Description cannot contain path traversal sequences',
    };
  }

  // Check for null bytes and control characters
  for (let i = 0; i < prompt.length; i++) {
    const code = prompt.charCodeAt(i);
    // Null byte (0) or other control characters (0-31, 127)
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      return {
        valid: false,
        error: 'Description contains invalid control characters',
      };
    }
  }

  return { valid: true };
}

/**
 * Escape a string for safe use in shell commands
 * Uses single quotes which prevent all expansions in bash
 */
export function escapeShellArg(arg: string): string {
  // If the string is empty, return empty quotes
  if (arg.length === 0) {
    return "''";
  }

  // Check if escaping is needed
  if (/[^a-zA-Z0-9_\-./]/.test(arg)) {
    // Use single quotes and escape single quotes by ending quote, adding escaped quote, starting new quote
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  // No escaping needed for safe characters
  return arg;
}
