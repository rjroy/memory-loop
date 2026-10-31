import { test as base } from '@playwright/test';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// An isolated checkout/build may be supplied without rebuilding a running checkout.
const projectRoot = process.env.MEMORY_LOOP_E2E_PROJECT_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
export const fixtureToken = 'f'.repeat(64);
const execFileAsync = promisify(execFile);

async function resolveBun(home: string): Promise<string> {
  const manifest: unknown = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('packageManager' in manifest) ||
      typeof manifest.packageManager !== 'string' || !/^bun@\d+\.\d+\.\d+$/.test(manifest.packageManager)) {
    throw new Error('A pinned Bun packageManager is required for the fixture');
  }
  const expectedVersion = manifest.packageManager.slice('bun@'.length);
  const seen = new Set<string>();
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      const candidate = await realpath(join(directory, 'bun'));
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const { stdout } = await execFileAsync(candidate, ['--version'], {
        env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'production' }, timeout: 5000,
      });
      if (stdout.trim() === expectedVersion) return candidate;
    } catch { /* Try the next executable without trusting a version-manager shim. */ }
  }
  throw new Error(`No runnable Bun ${expectedVersion} executable found on PATH for the isolated fixture`);
}

export const hostileMarkdown = [
  '# Source heading',
  '<script>window.recallScriptRan = true</script>',
  '',
  '<img src="http://127.0.0.1:9/remote-sentinel">',
  '',
  '![test image](./local-sentinel.png)',
  '[unsafe](javascript:alert(1)) [web](https://example.invalid/test) [relative](other.md)',
  '- [x] task fixture',
  '',
  '| A | B |', '| --- | --- |', `| ${'wide'.repeat(90)} | cell |`,
  '', '```', 'wide-code-'.repeat(100), '```',
  ...Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'fixture prose '.repeat(12)}`),
].join('\n');

function exited(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  try {
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
}

function probe(port: number, path: string, headers: Record<string, string> = {}): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, headers, timeout: 500 }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Fixture readiness timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function waitReady(child: ChildProcessWithoutNullStreams, port: number, path: string, headers: Record<string, string>, logs: () => string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned fixture process exited before readiness: ${logs()}`);
    try { if (await probe(port, path, headers) === 200) return; } catch { /* Listener is not ready yet. */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Owned fixture process did not become ready: ${logs()}`);
}

async function stop(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.pid === undefined) return;
  const exit = exited(child);
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch (error: unknown) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([exit, new Promise<void>(resolve => { timer = setTimeout(resolve, 3000); })]); }
  finally { if (timer) clearTimeout(timer); }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error: unknown) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error;
  }
  await exit;
}

export const test = base.extend<object, { recallOrigin: string; captureVault: string; ownedFixture: { origin: string; vault: string } }>({
  baseURL: async ({ recallOrigin }, use) => { await use(recallOrigin); },
  recallOrigin: [async ({ ownedFixture }, use) => { await use(ownedFixture.origin); }, { scope: 'worker' }],
  captureVault: [async ({ ownedFixture }, use) => { await use(ownedFixture.vault); }, { scope: 'worker' }],
  ownedFixture: [async ({}, use) => {
    const fixture = await mkdtemp(join(tmpdir(), 'memory-loop-browser-'));
    let daemon: ChildProcessWithoutNullStreams | undefined;
    let web: ChildProcessWithoutNullStreams | undefined;
    try {
      const app = join(fixture, 'app');
      const vault = join(fixture, 'vault');
      await mkdir(join(app, '.memory-loop'), { recursive: true, mode: 0o700 });
      await mkdir(join(vault, 'folder'), { recursive: true });
      await writeFile(join(app, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault }));
      await writeFile(join(vault, 'alpha.md'), '# Alpha heading\n\nAlpha fixture body.\n');
      await writeFile(join(vault, 'folder', 'beta.md'), '# Beta heading\n\nBeta fixture body.\n');
      await writeFile(join(vault, 'danger.md'), hostileMarkdown);
      await writeFile(join(vault, 'empty.md'), '');
      await writeFile(join(vault, 'local-sentinel.png'), 'fixture-not-an-image');
      const daemonPort = await freePort();
      let webPort = await freePort();
      while (webPort === daemonPort) webPort = await freePort();
      const origin = `http://127.0.0.1:${webPort}`;
      const metadata = join(app, '.memory-loop');
      const transportFile = join(metadata, 'transport.json');
      await writeFile(join(metadata, 'service.token'), fixtureToken, { mode: 0o600 });
      await writeFile(transportFile, JSON.stringify({ daemonOrigin: `http://127.0.0.1:${daemonPort}`, web: { mode: 'loopback', origin } }), { mode: 0o600 });
      const bun = await resolveBun(fixture);
      const env: NodeJS.ProcessEnv = { PATH: `${dirname(bun)}${delimiter}${process.env.PATH ?? ''}`, HOME: fixture, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', MEMORY_LOOP_TRANSPORT_FILE: transportFile };
      let daemonLogs = '';
      daemon = spawn(bun, ['--no-env-file', 'run', 'daemon', '--project-root', app], { cwd: projectRoot, env, detached: true, stdio: 'pipe' });
      daemon.stdout.on('data', data => { daemonLogs += String(data); });
      daemon.stderr.on('data', data => { daemonLogs += String(data); });
      await waitReady(daemon, daemonPort, '/api/vault/tree', { authorization: `Bearer ${fixtureToken}` }, () => daemonLogs);
      let webLogs = '';
      web = spawn(bun, ['--no-env-file', 'run', 'server', '--port', String(webPort)], { cwd: projectRoot, env, detached: true, stdio: 'pipe' });
      web.stdout.on('data', data => { webLogs += String(data); });
      web.stderr.on('data', data => { webLogs += String(data); });
      await waitReady(web, webPort, '/ground', {}, () => webLogs);
      await use({ origin, vault });
    } finally {
      try {
        try { await stop(web); } finally { await stop(daemon); }
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  }, { scope: 'worker' }],
});

export { expect } from '@playwright/test';
