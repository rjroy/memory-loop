import { jest } from 'bun:test';
import { createInterface } from 'node:readline';

// Test-owned subprocess preload only: production receives no clock flag or control route.
const initial = Number(process.env.GROUND_FIXTURE_NOW);
if (!Number.isSafeInteger(initial) || initial <= 0) throw new Error('missing owned fixture clock');
jest.useFakeTimers({ now: initial });
let pulses = 0;
setTimeout(() => pulses++, 500).unref();
console.info('ground_fixture_clock', JSON.stringify({ now: Date.now(), pulses }));

const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
      !('advanceMs' in value) || typeof value.advanceMs !== 'number' || !Number.isSafeInteger(value.advanceMs) ||
      value.advanceMs < 0 || value.advanceMs > 30000) throw new Error('invalid fixture clock step');
  jest.advanceTimersByTime(value.advanceMs);
  // Let async timer callbacks enter their first continuation before acknowledging the step.
  void new Promise<void>(resolve => setImmediate(resolve)).then(() => {
    console.info('ground_fixture_step', JSON.stringify({ id: value.id, now: Date.now(), pulses }));
  });
});
