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

      await register({});
    });

    test('does nothing when NEXT_RUNTIME is not nodejs', async () => {
      process.env.NEXT_RUNTIME = 'edge';

      let bootstrapSchedulersCalled = false;

      const mockBootstrapSchedulers = async () => {
        bootstrapSchedulersCalled = true;
      };

      await register({ bootstrapSchedulers: mockBootstrapSchedulers });

      expect(bootstrapSchedulersCalled).toBe(false);
    });

    test('calls bootstrapSchedulers in production mode', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'production';

      let bootstrapSchedulersCalled = false;

      const mockBootstrapSchedulers = async () => {
        bootstrapSchedulersCalled = true;
      };

      await register({
        bootstrapSchedulers: mockBootstrapSchedulers
      });

      expect(bootstrapSchedulersCalled).toBe(true);
    });

    test('does not call bootstrapSchedulers in development mode', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'development';

      let bootstrapSchedulersCalled = false;

      const mockBootstrapSchedulers = async () => {
        bootstrapSchedulersCalled = true;
      };

      await register({
        bootstrapSchedulers: mockBootstrapSchedulers
      });

      expect(bootstrapSchedulersCalled).toBe(false);
    });

    test('continues when bootstrapSchedulers throws error', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'production';

      const mockBootstrapSchedulers = async () => {
        throw new Error('Bootstrap failed');
      };

      // Should not throw - error is caught and logged
      await register({
        bootstrapSchedulers: mockBootstrapSchedulers
      });
      // No exception propagated - server continues
    });
  });
});
