import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { register } from '../instrumentation';

describe('instrumentation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('register', () => {
    test('runs without error when NEXT_RUNTIME is nodejs', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'development';

      await register();
    });

    test('does nothing when NEXT_RUNTIME is not nodejs', async () => {
      process.env.NEXT_RUNTIME = 'edge';
      // Should complete without error
      await register();
    });

    test('runs without error in production mode', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'production';
      // Schedulers now run in daemon, so register() is a no-op for schedulers
      await register();
    });
  });
});
