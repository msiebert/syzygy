#!/usr/bin/env bun

/**
 * Syzygy - CLI Entry Point
 * Orchestrate multiple Claude Code instances for comprehensive development
 */

import { version } from '../package.json';

async function main(): Promise<void> {
  console.log(`Syzygy v${version}`);
  console.log('Claude Code Orchestrator\n');

  // TODO: Implement CLI
  // - Main menu
  // - Workflow management
  // - Settings
  console.log('🚧 Under construction - foundation setup complete!');
  console.log('\nNext steps:');
  console.log('1. Implement tmux-utils.ts');
  console.log('2. Implement session-manager.ts');
  console.log('3. Implement stage-manager.ts');
  console.log('4. Build interactive menu with Ink');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
