/**
 * Configuration management
 */

import { z } from 'zod';

export const ConfigSchema: z.ZodObject<{
  numDevelopers: z.ZodDefault<z.ZodNumber>;
  logLevel: z.ZodDefault<z.ZodEnum<['debug', 'info', 'warn', 'error']>>;
  workspaceRoot: z.ZodDefault<z.ZodString>;
  sessionLifecycle: z.ZodDefault<z.ZodEnum<['clean-start', 'persistent']>>;
}> = z.object({
  numDevelopers: z.number().min(1).max(10).default(1),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  workspaceRoot: z.string().default('.syzygy'),
  sessionLifecycle: z.enum(['clean-start', 'persistent']).default('clean-start'),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: Config = {
  numDevelopers: 1,
  logLevel: 'info',
  workspaceRoot: '.syzygy',
  sessionLifecycle: 'clean-start',
};

/**
 * Load configuration from file or use defaults
 */
export function loadConfig(_path?: string): Config {
  // TODO: Implement config file loading
  return DEFAULT_CONFIG;
}

/**
 * Save configuration to file
 */
export function saveConfig(_config: Config, _path: string): void {
  // TODO: Implement config saving
}
