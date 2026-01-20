/**
 * Test setup and global test utilities
 */

import { beforeAll, afterAll } from 'bun:test';

// Global test setup
beforeAll(() => {
  // Setup tasks before all tests
  // e.g., clean up test directories, initialize mocks
});

// Global test cleanup
afterAll(() => {
  // Cleanup tasks after all tests
  // e.g., remove temp files, close connections
});

// Test utilities
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await sleep(interval);
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
};
