/**
 * Unit tests for FileMonitor
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { FileMonitor } from '@core/file-monitor';
import { FileMonitorError } from '../../src/types/message.types';
import type { WorkflowEvent } from '../../src/types/workflow.types';

// Mock chokidar
interface MockWatcher {
  on: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

const mockWatcher: MockWatcher = {
  on: mock((_event: string, _handler: (path: string) => void) => mockWatcher),
  close: mock(async () => {}),
};

const mockWatch = mock((_paths: string | string[], _options?: unknown) => {
  return mockWatcher;
});

mock.module('chokidar', () => ({
  default: {
    watch: mockWatch,
  },
}));

describe('FileMonitor', () => {
  let monitor: FileMonitor;

  beforeEach(() => {
    monitor = new FileMonitor();

    // Reset mocks
    mockWatch.mockClear();
    mockWatcher.on.mockClear();
    mockWatcher.close.mockClear();
  });

  afterEach(async () => {
    if (monitor.isRunning()) {
      await monitor.stop();
    }
  });

  describe('initialization', () => {
    it('should initialize with default options', () => {
      expect(monitor).toBeDefined();
      expect(monitor.isRunning()).toBe(false);
    });

    it('should accept custom options', () => {
      const customMonitor = new FileMonitor({
        debounceMs: 200,
        ignoreInitial: false,
      });

      expect(customMonitor).toBeDefined();
    });

    it('should start with empty watch paths', () => {
      expect(monitor.getWatchPaths()).toEqual([]);
    });
  });

  describe('addWatchPath', () => {
    it('should add a watch path', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');

      expect(monitor.getWatchPaths()).toContain('.syzygy/stages/spec/pending');
    });

    it('should add multiple watch paths', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.addWatchPath('.syzygy/stages/arch/pending');

      const paths = monitor.getWatchPaths();
      expect(paths).toHaveLength(2);
      expect(paths).toContain('.syzygy/stages/spec/pending');
      expect(paths).toContain('.syzygy/stages/arch/pending');
    });

    it('should throw error if adding path after start', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      expect(() => {
        monitor.addWatchPath('.syzygy/stages/arch/pending');
      }).toThrow(FileMonitorError);
    });
  });

  describe('start', () => {
    it('should start monitoring with configured paths', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      expect(mockWatch).toHaveBeenCalledTimes(1);
      expect(monitor.isRunning()).toBe(true);
    });

    it('should throw error if no watch paths configured', () => {
      expect(() => {
        monitor.start();
      }).toThrow(FileMonitorError);
    });

    it('should not start if already started', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      mockWatch.mockClear();
      monitor.start();

      expect(mockWatch).not.toHaveBeenCalled();
    });

    it('should register event handlers', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      // Check that event handlers were registered
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should configure chokidar with correct options', () => {
      monitor = new FileMonitor({
        debounceMs: 200,
        ignoreInitial: false,
      });

      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      const call = mockWatch.mock.calls[0];
      const options = call?.[1] as Record<string, unknown>;

      expect(options['ignoreInitial']).toBe(false);
      expect(options['awaitWriteFinish']).toBeDefined();
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();
    });

    it('should stop monitoring', async () => {
      await monitor.stop();

      expect(mockWatcher.close).toHaveBeenCalledTimes(1);
      expect(monitor.isRunning()).toBe(false);
    });

    it('should handle stop when not started', async () => {
      await monitor.stop();

      mockWatcher.close.mockClear();

      await monitor.stop();

      expect(mockWatcher.close).not.toHaveBeenCalled();
    });
  });

  describe('event listeners', () => {
    it('should register event listener', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      monitor.on('artifact:created', listener);

      // Trigger the event by simulating chokidar add event
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      // Get the 'add' handler that was registered with chokidar
      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      expect(addHandler).toBeDefined();

      // Simulate file added event
      addHandler!('.syzygy/stages/spec/pending/test.md');

      expect(listener).toHaveBeenCalledTimes(1);

      const event = listener.mock.calls[0]![0] as WorkflowEvent;
      expect(event.type).toBe('artifact:created');
      expect(event.payload).toMatchObject({
        artifactPath: '.syzygy/stages/spec/pending/test.md',
        stageName: 'spec',
      });
    });

    it('should support multiple listeners for same event', () => {
      const listener1 = mock((_event: WorkflowEvent) => {});
      const listener2 = mock((_event: WorkflowEvent) => {});

      monitor.on('artifact:created', listener1);
      monitor.on('artifact:created', listener2);

      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      addHandler!('.syzygy/stages/spec/pending/test.md');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should unregister event listener', () => {
      const listener = mock((_event: WorkflowEvent) => {});

      monitor.on('artifact:created', listener);
      monitor.off('artifact:created', listener);

      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      addHandler!('.syzygy/stages/spec/pending/test.md');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const failingListener = mock((_event: WorkflowEvent) => {
        throw new Error('Listener error');
      });
      const workingListener = mock((_event: WorkflowEvent) => {});

      monitor.on('artifact:created', failingListener);
      monitor.on('artifact:created', workingListener);

      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      // Should not throw
      expect(() => {
        addHandler!('.syzygy/stages/spec/pending/test.md');
      }).not.toThrow();

      expect(failingListener).toHaveBeenCalled();
      expect(workingListener).toHaveBeenCalled();
    });
  });

  describe('file events', () => {
    beforeEach(() => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();
    });

    it('should emit artifact:created on file add', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      monitor.on('artifact:created', listener);

      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      addHandler!('.syzygy/stages/spec/pending/feature.md');

      expect(listener).toHaveBeenCalledTimes(1);

      const event = listener.mock.calls[0]![0] as WorkflowEvent;
      expect(event.type).toBe('artifact:created');
      expect(event.payload).toMatchObject({
        artifactPath: '.syzygy/stages/spec/pending/feature.md',
        stageName: 'spec',
      });
    });

    it('should emit artifact:modified on file change', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      monitor.on('artifact:modified', listener);

      const changeHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'change'
      );
      const changeHandler = changeHandlerCall?.[1] as ((path: string) => void) | undefined;

      changeHandler!('.syzygy/stages/arch/pending/architecture.md');

      expect(listener).toHaveBeenCalledTimes(1);

      const event = listener.mock.calls[0]![0] as WorkflowEvent;
      expect(event.type).toBe('artifact:modified');
      expect(event.payload).toMatchObject({
        artifactPath: '.syzygy/stages/arch/pending/architecture.md',
        stageName: 'arch',
      });
    });

    it('should emit artifact:deleted on file unlink', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      monitor.on('artifact:deleted', listener);

      const unlinkHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'unlink'
      );
      const unlinkHandler = unlinkHandlerCall?.[1] as ((path: string) => void) | undefined;

      unlinkHandler!('.syzygy/stages/tasks/pending/task-1.md');

      expect(listener).toHaveBeenCalledTimes(1);

      const event = listener.mock.calls[0]![0] as WorkflowEvent;
      expect(event.type).toBe('artifact:deleted');
      expect(event.payload).toMatchObject({
        artifactPath: '.syzygy/stages/tasks/pending/task-1.md',
        stageName: 'tasks',
      });
    });

    it('should extract correct stage names', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      monitor.on('artifact:created', listener);

      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      const testCases = [
        { path: '.syzygy/stages/spec/pending/test.md', expectedStage: 'spec' },
        { path: '.syzygy/stages/arch/pending/test.md', expectedStage: 'arch' },
        { path: '.syzygy/stages/tasks/pending/test.md', expectedStage: 'tasks' },
        { path: '.syzygy/stages/tests/pending/test.md', expectedStage: 'tests' },
        { path: '.syzygy/stages/impl/pending/test.md', expectedStage: 'impl' },
        { path: '.syzygy/stages/review/pending/test.md', expectedStage: 'review' },
        { path: '.syzygy/stages/docs/pending/test.md', expectedStage: 'docs' },
      ];

      for (const { path, expectedStage } of testCases) {
        listener.mockClear();
        addHandler!(path);

        expect(listener).toHaveBeenCalledTimes(1);

        const event = listener.mock.calls[0]![0] as WorkflowEvent;
        expect(event.payload).toMatchObject({
          stageName: expectedStage,
        });
      }
    });

    it('should ignore files without valid stage path', () => {
      const listener = mock((_event: WorkflowEvent) => {});
      monitor.on('artifact:created', listener);

      const addHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'add'
      );
      const addHandler = addHandlerCall?.[1] as ((path: string) => void) | undefined;

      // Invalid paths
      addHandler!('random-file.md');
      addHandler!('.syzygy/config.json');
      addHandler!('src/core/test.ts');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle watcher errors gracefully', () => {
      const errorHandlerCall = mockWatcher.on.mock.calls.find(
        (call) => call?.[0] === 'error'
      );
      const errorHandler = errorHandlerCall?.[1] as ((error: Error) => void) | undefined;

      // Should not throw
      expect(() => {
        errorHandler!(new Error('Watcher error'));
      }).not.toThrow();
    });
  });

  describe('getWatchPaths', () => {
    it('should return copy of watch paths', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');

      const paths1 = monitor.getWatchPaths();
      const paths2 = monitor.getWatchPaths();

      expect(paths1).not.toBe(paths2);
      expect(paths1).toEqual(paths2);
    });
  });

  describe('isRunning', () => {
    it('should return false initially', () => {
      expect(monitor.isRunning()).toBe(false);
    });

    it('should return true after start', () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();

      expect(monitor.isRunning()).toBe(true);
    });

    it('should return false after stop', async () => {
      monitor.addWatchPath('.syzygy/stages/spec/pending');
      monitor.start();
      await monitor.stop();

      expect(monitor.isRunning()).toBe(false);
    });
  });
});
