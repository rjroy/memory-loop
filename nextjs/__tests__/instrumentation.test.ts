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
    test('calls checkCwebpAvailability when NEXT_RUNTIME is nodejs', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'development';

      let checkCwebpCalled = false;

      const mockCheckCwebp = async () => {
        checkCwebpCalled = true;
        return true;
      };

      await register({ checkCwebpAvailability: mockCheckCwebp });

      expect(checkCwebpCalled).toBe(true);
    });

    test('server continues when cwebp binary is missing (REQ-IMAGE-WEBP-16)', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'development';

      let checkCwebpCalled = false;

      const mockCheckCwebp = async () => {
        checkCwebpCalled = true;
        return false; // Binary missing
      };

      // Server should continue despite missing binary
      await register({ checkCwebpAvailability: mockCheckCwebp });

      expect(checkCwebpCalled).toBe(true);
      // No exception thrown - server continues
    });

    test('does not call checkCwebpAvailability when NEXT_RUNTIME is not nodejs', async () => {
      process.env.NEXT_RUNTIME = 'edge';

      let checkCwebpCalled = false;

      const mockCheckCwebp = async () => {
        checkCwebpCalled = true;
        return true;
      };

      await register({ checkCwebpAvailability: mockCheckCwebp });

      // checkCwebpAvailability should not be called when NEXT_RUNTIME is edge
      expect(checkCwebpCalled).toBe(false);
    });

    test('calls bootstrapSchedulers in production mode', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'production';

      let bootstrapSchedulersCalled = false;
      let checkCwebpCalled = false;

      const mockCheckCwebp = async () => {
        checkCwebpCalled = true;
        return true;
      };

      const mockBootstrapSchedulers = async () => {
        bootstrapSchedulersCalled = true;
      };

      await register({
        checkCwebpAvailability: mockCheckCwebp,
        bootstrapSchedulers: mockBootstrapSchedulers
      });

      expect(checkCwebpCalled).toBe(true);
      expect(bootstrapSchedulersCalled).toBe(true);
    });

    test('does not call bootstrapSchedulers in development mode', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'development';

      let bootstrapSchedulersCalled = false;
      let checkCwebpCalled = false;

      const mockCheckCwebp = async () => {
        checkCwebpCalled = true;
        return true;
      };

      const mockBootstrapSchedulers = async () => {
        bootstrapSchedulersCalled = true;
      };

      await register({
        checkCwebpAvailability: mockCheckCwebp,
        bootstrapSchedulers: mockBootstrapSchedulers
      });

      expect(checkCwebpCalled).toBe(true);
      expect(bootstrapSchedulersCalled).toBe(false);
    });

    test('continues when bootstrapSchedulers throws error', async () => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.NODE_ENV = 'production';

      let checkCwebpCalled = false;

      const mockCheckCwebp = async () => {
        checkCwebpCalled = true;
        return true;
      };

      const mockBootstrapSchedulers = async () => {
        throw new Error('Bootstrap failed');
      };

      // Should not throw - error is caught and logged
      await register({
        checkCwebpAvailability: mockCheckCwebp,
        bootstrapSchedulers: mockBootstrapSchedulers
      });

      expect(checkCwebpCalled).toBe(true);
      // No exception propagated - server continues
    });
  });
});
