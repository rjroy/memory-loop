import { execFileSync, spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs under Node; resolve the Bun executable on the caller's PATH. */
function bunExecutable(): string {
  const resolved = spawnSync('bun', ['--no-env-file', '-e', 'process.stdout.write(process.execPath)'], { encoding: 'utf8' });
  if (resolved.error || resolved.status !== 0 || !isAbsolute(resolved.stdout)) {
    throw new Error(`Could not resolve Bun executable: ${resolved.error?.message ?? resolved.stderr}`);
  }
  return resolved.stdout;
}

describe('Think monitor cancellation bookkeeping', () => {
  it('keeps retained heap bounded across a sustained stream and closes the monitor', () => {
    const output = execFileSync(bunExecutable(), ['--no-env-file', 'tests/think-monitor-memory.ts'], {
      encoding: 'utf8', timeout: 15_000, maxBuffer: 16_384,
    });
    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({ count: 220_000, closed: true });
    expect(result).toHaveProperty('growth', expect.any(Number));
    if (typeof result !== 'object' || result === null || !('growth' in result) || typeof result.growth !== 'number') throw new Error('invalid fixture measurement');
    expect(result.growth).toBeLessThan(8 * 1024 * 1024);
  }, 20_000);
});
