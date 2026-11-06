import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

const runner = resolve(import.meta.dirname, '../tests/ground-generation-publication-fixture.ts');
for (const scenario of ['manual', 'absence', 'lost-confirmation', 'v7-migration', 'v8-migration', 'create-interruption', 'unbound-substitution', 'terminal-cleanup-interruption', 'case-duplicate', 'permissive-recovery', 'nonportable-publication', 'legacy-target-recovery', 'legacy-parent-recovery', 'nonportable-missing-parent', 'write-sync-normal', 'write-sync-recovery', 'write-sync-terminal-cleanup', 'write-sync-io-failure', 'simulated-win-invalid-parent'] as const) {
  // Windows cannot create the literal colon-bearing legacy names these recovery cases require.
  it.skipIf((process.platform === 'win32' && ['legacy-target-recovery', 'legacy-parent-recovery'].includes(scenario)) ||
    (process.platform !== 'linux' && scenario === 'simulated-win-invalid-parent'))(
  `preserves owned publication boundaries: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ground-publication-test-'));
    try {
      const result = spawnSync('bun', ['--no-env-file', runner, root, scenario], {
        cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024,
        env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: root,
          XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root, TEMP: root, TMP: root },
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, `owned SQLite/filesystem fixture failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(JSON.stringify({ scenario, passed: true }));
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000,
  );
}
