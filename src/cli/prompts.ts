/**
 * User input prompts and interactions
 */

import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { createModuleLogger } from '@utils/logger';
import { validateFeatureName, validateInitialPrompt } from '@utils/sanitize';

const logger = createModuleLogger('prompts');

/**
 * Normalize stdin state before readline operations
 * This ensures stdin is in a clean state after Ink unmounts
 */
function normalizeStdin(): void {
  // Ensure stdin is not paused
  if (input.isPaused()) {
    input.resume();
  }

  // Ensure raw mode is disabled for readline
  if (input.setRawMode) {
    input.setRawMode(false);
  }

  // Ensure stdin is referenced (keeps event loop alive)
  input.ref();

  logger.debug('Stdin normalized for readline');
}

/**
 * Ask user a yes/no question
 */
export async function askYesNo(question: string, defaultValue = false): Promise<boolean> {
  normalizeStdin();
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    const defaultText = defaultValue ? '[Y/n]' : '[y/N]';
    const fullQuestion = `${question} ${defaultText}: `;

    rl.question(fullQuestion, (answer) => {
      rl.close();

      const normalized = answer.trim().toLowerCase();

      if (normalized === '') {
        resolve(defaultValue);
        return;
      }

      const result = normalized === 'y' || normalized === 'yes';
      logger.debug({ question, answer: normalized, result }, 'Yes/No prompt answered');
      resolve(result);
    });
  });
}

/**
 * Ask user to input text
 */
export async function askText(question: string, defaultValue = ''): Promise<string> {
  normalizeStdin();
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    const defaultText = defaultValue ? `[${defaultValue}]` : '';
    const fullQuestion = `${question} ${defaultText}: `;

    rl.question(fullQuestion, (answer) => {
      rl.close();

      const result = answer.trim() || defaultValue;
      logger.debug({ question, answer: result }, 'Text prompt answered');
      resolve(result);
    });
  });
}

/**
 * Ask user to select from a list of options
 */
export async function askChoice<T extends string>(
  question: string,
  choices: readonly T[],
  defaultChoice?: T
): Promise<T> {
  normalizeStdin();
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    // Display question and choices
    console.log(`\n${question}`);
    choices.forEach((choice, index) => {
      const marker = choice === defaultChoice ? '*' : ' ';
      console.log(`${marker} ${index + 1}. ${choice}`);
    });

    const defaultText = defaultChoice ? `[${choices.indexOf(defaultChoice) + 1}]` : '';
    const fullQuestion = `\nSelect (1-${choices.length}) ${defaultText}: `;

    rl.question(fullQuestion, (answer) => {
      rl.close();

      // Handle default
      if (answer.trim() === '' && defaultChoice !== undefined) {
        logger.debug({ question, choice: defaultChoice }, 'Choice prompt answered (default)');
        resolve(defaultChoice);
        return;
      }

      // Parse selection
      const selection = parseInt(answer.trim(), 10);

      if (isNaN(selection) || selection < 1 || selection > choices.length) {
        console.log('Invalid selection. Please try again.');
        // Recursively ask again
        void askChoice(question, choices, defaultChoice).then(resolve);
        return;
      }

      const result = choices[selection - 1]!;
      logger.debug({ question, choice: result }, 'Choice prompt answered');
      resolve(result);
    });
  });
}

/**
 * Ask user to approve a spec
 */
export async function askSpecApproval(specContent: string): Promise<boolean> {
  console.log('\n' + '='.repeat(80));
  console.log('SPECIFICATION READY FOR REVIEW');
  console.log('='.repeat(80) + '\n');
  console.log(specContent);
  console.log('\n' + '='.repeat(80) + '\n');

  return askYesNo('Approve this specification and begin implementation?', false);
}

/**
 * Error action choices
 */
export const ERROR_ACTIONS = [
  'View full error log',
  'Retry task',
  'Skip task',
  'Abort workflow',
] as const;

export type ErrorAction = typeof ERROR_ACTIONS[number];

/**
 * Ask user what to do about an error
 */
export async function askErrorAction(
  agentId: string,
  errorMessage: string
): Promise<ErrorAction> {
  console.log('\n' + '!'.repeat(80));
  console.log(`ERROR: ${agentId} failed`);
  console.log('!'.repeat(80));
  console.log(`\nError: ${errorMessage}\n`);

  return askChoice('What would you like to do?', ERROR_ACTIONS, 'View full error log');
}

/**
 * Settings that can be configured
 */
export interface SyzygySettings {
  numDevelopers: number;
  workspaceRoot: string;
  pollInterval: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Ask user to configure settings
 */
export async function askSettings(
  currentSettings: SyzygySettings
): Promise<SyzygySettings> {
  console.log('\n' + '='.repeat(80));
  console.log('SYZYGY SETTINGS');
  console.log('='.repeat(80) + '\n');

  const numDevelopers = parseInt(
    await askText('Number of parallel developers', currentSettings.numDevelopers.toString()),
    10
  );

  const workspaceRoot = await askText('Workspace root directory', currentSettings.workspaceRoot);

  const pollInterval = parseInt(
    await askText(
      'Agent poll interval (ms)',
      currentSettings.pollInterval.toString()
    ),
    10
  );

  const logLevel = await askChoice(
    'Log level',
    ['debug', 'info', 'warn', 'error'] as const,
    currentSettings.logLevel
  );

  const newSettings: SyzygySettings = {
    numDevelopers: isNaN(numDevelopers) ? currentSettings.numDevelopers : numDevelopers,
    workspaceRoot,
    pollInterval: isNaN(pollInterval) ? currentSettings.pollInterval : pollInterval,
    logLevel,
  };

  logger.info({ newSettings }, 'Settings updated');

  return newSettings;
}

/**
 * Ask for feature name
 */
export async function askFeatureName(): Promise<string> {
  while (true) {
    const featureName = await askText('What feature would you like to build?');

    if (!featureName) {
      console.log('Feature name cannot be empty. Please try again.');
      continue;
    }

    const validation = validateFeatureName(featureName);
    if (!validation.valid) {
      console.log(`Invalid feature name: ${validation.error}`);
      console.log('Please use 3-100 characters (letters, numbers, spaces, hyphens, special chars).');
      continue;
    }

    return featureName;
  }
}

/**
 * Ask for initial prompt (detailed description)
 */
export async function askInitialPrompt(): Promise<string> {
  console.log('\nDescribe what you want to build (this gives the PM a starting point)');
  console.log('Example: "I want JWT-based authentication with OAuth support for Google and GitHub"\n');

  while (true) {
    const prompt = await askText('Feature description');

    if (!prompt) {
      console.log('Description cannot be empty. Please try again.');
      continue;
    }

    const validation = validateInitialPrompt(prompt);
    if (!validation.valid) {
      console.log(`Invalid description: ${validation.error}`);
      continue;
    }

    return prompt;
  }
}

/**
 * Ask for both feature name and initial description
 */
export async function askFeatureInfo(): Promise<{ featureName: string; initialPrompt: string }> {
  const featureName = await askFeatureName();
  const initialPrompt = await askInitialPrompt();

  // Confirmation
  console.log('\n' + '='.repeat(60));
  console.log('Feature Setup Complete');
  console.log('='.repeat(60));
  console.log(`Name: ${featureName}`);
  console.log(`Description: ${initialPrompt}`);
  console.log('='.repeat(60) + '\n');

  return { featureName, initialPrompt };
}

/**
 * Display completion summary
 */
export function displayCompletionSummary(summary: {
  featureName: string;
  tasksCompleted: number;
  testsPassing: number;
  filesModified: number;
  duration: number;
}): void {
  console.log('\n' + '='.repeat(80));
  console.log('✅ WORKFLOW COMPLETE!');
  console.log('='.repeat(80) + '\n');
  console.log(`Feature: ${summary.featureName}`);
  console.log(`Tasks completed: ${summary.tasksCompleted}`);
  console.log(`Tests passing: ${summary.testsPassing}`);
  console.log(`Files modified: ${summary.filesModified}`);
  console.log(`Duration: ${Math.round(summary.duration / 1000)}s`);
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Display error message
 */
export function displayError(message: string, details?: string): void {
  console.log('\n' + '!'.repeat(80));
  console.log('❌ ERROR');
  console.log('!'.repeat(80) + '\n');
  console.log(message);
  if (details) {
    console.log(`\nDetails: ${details}`);
  }
  console.log('\n' + '!'.repeat(80) + '\n');
}

/**
 * Display info message
 */
export function displayInfo(message: string): void {
  console.log(`\nℹ️  ${message}\n`);
}

/**
 * Display success message
 */
export function displaySuccess(message: string): void {
  console.log(`\n✅ ${message}\n`);
}
