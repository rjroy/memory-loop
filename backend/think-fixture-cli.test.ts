import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const project = resolve(import.meta.dirname, '..');
let root: string;
let bun: string;
let path: string;

beforeAll(() => {
  // Vitest runs under Node, so resolve the Bun on the caller's PATH before isolating the child environment.
  const resolved = spawnSync('bun', ['--no-env-file', '-e', 'process.stdout.write(process.execPath)'], { encoding: 'utf8' });
  if (resolved.error || resolved.status !== 0 || !isAbsolute(resolved.stdout)) {
    throw new Error(`Could not resolve Bun executable: ${resolved.error?.message ?? resolved.stderr}`);
  }
  bun = resolved.stdout;
  // Only the system directories (and, on Windows, Bun's own directory for `bun run` scripts) are inherited.
  path = process.platform === 'win32'
    ? [dirname(bun), join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(delimiter)
    : '/usr/bin:/bin';
});
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'think-fixture-cli-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function requirePackageCommand() {
  const pkg: unknown = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  expect(pkg, 'package must expose the operator fixture command').toMatchObject({ scripts: { 'think:fixture': expect.any(String) } });
}

function invoke(args: string[], selector?: string) {
  // The test provides no inherited HOME, XDG settings, native credentials or selector.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: path, HOME: root, XDG_CONFIG_HOME: root,
    XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root,
    ...(process.platform === 'win32' ? { TEMP: root, TMP: root } : {}),
    ...(selector === undefined ? {} : { OPENCODE_TEST_BINARY: selector }) };
  return spawnSync(bun, ['--no-env-file', 'run', '--cwd', project, 'think:fixture', ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
  });
}

describe('operator Think fixture command', () => {
  it('exists and prints safe usage without starting the fixture', async () => {
    await requirePackageCommand();
    const result = invoke(['--help']);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/OPENCODE_TEST_BINARY/);
    expect(result.stdout + result.stderr).toMatch(/fixture/i);
  });

  it.each(['missing', 'relative', 'untrusted executable'] as const)('fails closed for %s selector before executing it', async kind => {
    await requirePackageCommand();
    const marker = join(root, 'unexpected-execution');
    const executable = join(root, 'fake-opencode');
    await writeFile(executable, `#!/bin/sh\nprintf called > '${marker}'\n`, { mode: 0o700 });
    const selected = kind === 'missing' ? undefined : kind === 'relative' ? 'fake-opencode' : executable;
    const result = invoke([], selected);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/OPENCODE_TEST_BINARY|binary|executable|selector/i);
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
