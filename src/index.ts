#!/usr/bin/env bun

/**
 * Syzygy - CLI Entry Point
 * Orchestrate multiple Claude Code instances for comprehensive development
 */

import { version } from '../package.json';
import { Orchestrator } from './core/orchestrator.js';
import { showMenu, showMessage } from './cli/menu.js';
import {
  askFeatureInfo,
  askSettings,
  displayCompletionSummary,
  displayError,
  displayInfo,
  type SyzygySettings,
} from './cli/prompts.js';
import { createModuleLogger } from '@utils/logger';
import type { MenuChoice } from './cli/menu.js';

const logger = createModuleLogger('main');

// Default settings
const DEFAULT_SETTINGS: SyzygySettings = {
  numDevelopers: 1,
  workspaceRoot: process.cwd(),
  pollInterval: 2000,
  logLevel: 'info',
};

let currentSettings: SyzygySettings = { ...DEFAULT_SETTINGS };

/**
 * Display banner
 */
function displayBanner(): void {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                ║');
  console.log('║                 SYZYGY ORCHESTRATOR v' + version.padEnd(26) + '║');
  console.log('║                                                                ║');
  console.log('║         Multi-Agent Development Workflow System                ║');
  console.log('║                                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
}

/**
 * Handle new feature workflow
 */
async function handleNewFeature(): Promise<void> {
  try {
    // Ask for feature name and description
    const { featureName, initialPrompt } = await askFeatureInfo();

    displayInfo(`Starting workflow for: ${featureName}`);

    // Create orchestrator
    const orchestrator = new Orchestrator({
      numDevelopers: currentSettings.numDevelopers,
      workspaceRoot: currentSettings.workspaceRoot,
      pollInterval: currentSettings.pollInterval,
    });

    try {
      // Start workflow - returns quickly, Claude init happens in background
      await orchestrator.startWorkflow(featureName, initialPrompt);

      // Start UI immediately - shows initialization progress until PM is ready
      orchestrator.startUI();

      // Event loop control
      let shouldExit = false;

      // Setup SIGINT handler (non-blocking)
      process.once('SIGINT', () => {
        logger.info('Received SIGINT, stopping workflow');
        shouldExit = true;
      });

      // Event loop: monitor for completion (orchestrator handles UI)
      while (!shouldExit) {
        const currentState = orchestrator.getWorkflowState();

        // Check for completion
        if (currentState === 'complete') {
          logger.info({ state: currentState }, 'Workflow completed successfully');
          displayInfo('Workflow completed successfully!');
          break;
        } else if (currentState === 'error') {
          logger.error({ state: currentState }, 'Workflow failed');
          displayError('Workflow failed', 'See logs for details');
          break;
        }

        // Sleep to avoid busy-waiting (500ms polling interval)
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      await orchestrator.stopWorkflow();
    }

    displayCompletionSummary({
      featureName,
      tasksCompleted: 0,
      testsPassing: 0,
      filesModified: 0,
      duration: 0,
    });
  } catch (error) {
    if (error instanceof Error) {
      displayError('Workflow failed', error.message);
      logger.error({ error }, 'Workflow error');
    }
    throw error;
  }
}

/**
 * Handle resume workflow
 */
async function handleResumeWorkflow(): Promise<void> {
  await showMessage(
    'Resume Workflow',
    'Resume workflow is not yet implemented.\nThis will allow you to continue a previously started workflow.',
    'info'
  );
}

/**
 * Handle settings
 */
async function handleSettings(): Promise<void> {
  try {
    const newSettings = await askSettings(currentSettings);
    currentSettings = newSettings;

    await showMessage(
      'Settings Updated',
      'Your settings have been saved for this session.',
      'success'
    );
  } catch (error) {
    if (error instanceof Error) {
      displayError('Settings error', error.message);
    }
  }
}

/**
 * Main menu loop
 */
async function mainLoop(): Promise<void> {
  let running = true;

  while (running) {
    displayBanner();

    const choice: MenuChoice = await showMenu();

    switch (choice) {
      case 'new-feature':
        await handleNewFeature();
        break;

      case 'resume-workflow':
        await handleResumeWorkflow();
        break;

      case 'settings':
        await handleSettings();
        break;

      case 'exit':
        running = false;
        displayInfo('Goodbye!');
        break;

      default:
        logger.warn({ choice }, 'Unknown menu choice');
    }
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info({ version }, 'Syzygy starting');

  try {
    await mainLoop();
  } catch (error) {
    logger.error({ error }, 'Fatal error in main loop');
    throw error;
  }

  logger.info('Syzygy exiting');
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});
