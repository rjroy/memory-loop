import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const runner = resolve(import.meta.dirname, '../tests/ground-generation-publication-fixture.ts');
it.each(['manual', 'absence', 'lost-confirmation', 'v7-migration', 'v8-migration', 'create-interruption', 'unbound-substitution', 'terminal-cleanup-interruption', 'case-duplicate'] as const)(
  'preserves owned publication boundaries: %s', async scenario => {
    const root = await mkdtemp('/tmp/opencode/ground-publication-test-');
    try {
      const result = spawnSync('/usr/bin/bun', ['--no-env-file', runner, root, scenario], {
        cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024,
        env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: root, XDG_CONFIG_HOME: root,
          XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root },
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, `owned SQLite/filesystem fixture failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(JSON.stringify({ scenario, passed: true }));
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000,
);
