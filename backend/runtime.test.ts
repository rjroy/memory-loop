import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const entrypoint = fileURLToPath(new URL('./runtime.ts', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
let fixture: string;
let child: ChildProcessWithoutNullStreams | undefined;
let ownedScriptGroup: number | undefined;
let occupied: Server | undefined;
let stderr: string;

beforeEach(async () => {
  child = undefined;
  ownedScriptGroup = undefined;
  occupied = undefined;
  stderr = '';
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-runtime-test-'));
  await mkdir(join(fixture, 'project', '.memory-loop'), { recursive: true });
  await mkdir(join(fixture, 'vault', 'folder'), { recursive: true });
  await mkdir(join(fixture, 'dist'), { recursive: true });
  await writeFile(join(fixture, 'vault', 'folder', 'note.md'), '# fixture\n');
  await writeFile(join(fixture, 'dist', 'index.html'), '<title>Fixture shell</title>');
  await writeFile(join(fixture, 'project', '.memory-loop', 'config.json'),
    JSON.stringify({ vaultDirectory: join(fixture, 'vault') }));
});

afterEach(async () => {
  try {
    if (ownedScriptGroup !== undefined) {
      try { process.kill(-ownedScriptGroup, 'SIGKILL'); }
      catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited(child);
    }
    if (occupied) await new Promise<void>((resolve, reject) => occupied?.close(error => error ? reject(error) : resolve()));
  } finally {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  }
});

function exited(process: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return Promise.resolve({ code: process.exitCode, signal: process.signalCode });
  }
  return new Promise((resolve, reject) => {
    process.once('exit', (code, signal) => resolve({ code, signal }));
    process.once('error', reject);
  });
}

async function reservePort(): Promise<{ listener: Server; port: number }> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  return { listener, port: (address as AddressInfo).port };
}

function launch(port: number, devOrigin?: string): ChildProcessWithoutNullStreams {
  const process = spawn('bun', ['--no-env-file', entrypoint, '--project-root', join(fixture, 'project'),
    '--dist', join(fixture, 'dist'), '--port', String(port),
    ...(devOrigin === undefined ? [] : ['--dev-origin', devOrigin])], { cwd: fixture, stdio: 'pipe' });
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', (data: string) => { stderr += data; });
  process.stdout.resume();
  child = process;
  return process;
}

async function waitReady(process: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) {
      throw new Error(`Runtime exited before becoming ready: ${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(250) });
      if (response.status === 200) return;
    } catch { /* Listener has not started yet. */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Runtime listener did not become ready: ${stderr}`);
}

async function startRuntime() {
  const { listener, port } = await reservePort();
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const process = launch(port);
  await waitReady(process, port);
  return { process, port, base: `http://127.0.0.1:${port}` };
}

function requestWithHost(port: number, host: string): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: '/api/vault/tree', headers: { host } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    request.setTimeout(3000, () => request.destroy(new Error('HTTP request timed out')));
    request.on('error', reject);
    request.end();
  });
}

it('preserves the requested Host in the test HTTP transport', async () => {
  const probe = createHttpServer((request, response) => response.end(request.headers.host));
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const response = await requestWithHost(address.port, 'evil.example');
    expect(response.status).toBe(200);
    expect(response.body).toBe('evil.example');
  } finally {
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
});

it('starts the daemon package script with forwarded fixture paths and port', async () => {
  const { listener, port } = await reservePort();
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const process = spawn('bun', ['--no-env-file', 'run', 'daemon', '--project-root', join(fixture, 'project'),
    '--dist', join(fixture, 'dist'), '--port', String(port)],
  { cwd: packageRoot, detached: true, stdio: 'pipe' });
  child = process;
  if (process.pid === undefined) throw new Error('Could not start test-owned daemon script');
  ownedScriptGroup = process.pid;
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', (text: string) => { stderr += text; });
  process.stdout.resume();
  await waitReady(process, port);
  const base = `http://127.0.0.1:${port}`;
  const tree = await fetch(`${base}/api/vault/tree`);
  expect(tree.status).toBe(200);
  expect(await tree.json()).toMatchObject({ entries: [{ name: 'folder', children: [{ name: 'note.md' }] }] });
  const note = await fetch(`${base}/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) })}`);
  expect(await note.json()).toEqual({ name: 'note.md', markdown: '# fixture\n' });
  const page = await fetch(`${base}/recall`, { headers: { accept: 'text/html' } });
  expect(await page.text()).toContain('Fixture shell');

  // Bun may wrap the runtime; signal only the process group created for this test.
  globalThis.process.kill(-ownedScriptGroup, 'SIGTERM');
  await Promise.race([exited(process), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Script shutdown timed out')), 3000))]);
  const deadline = Date.now() + 3000;
  let released = false;
  while (Date.now() < deadline && !released) {
    const probe = createServer();
    try {
      await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      released = true;
      await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE')) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  expect(released).toBe(true);
}, 10000);

it.each(['SIGTERM', 'SIGINT'] as const)('serves fixture API and SPA, rejects untrusted host/origin, and shuts down on %s', async signal => {
  const { process, base, port } = await startRuntime();
  const tree = await fetch(`${base}/api/vault/tree`);
  expect(tree.status).toBe(200);
  expect(await tree.json()).toMatchObject({ entries: [{ name: 'folder', children: [{ name: 'note.md' }] }] });
  const note = await fetch(`${base}/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) })}`);
  expect(await note.json()).toEqual({ name: 'note.md', markdown: '# fixture\n' });
  const page = await fetch(`${base}/recall`, { headers: { accept: 'text/html' } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Fixture shell');
  expect((await requestWithHost(port, 'evil.example')).status).toBe(403);
  expect((await fetch(`${base}/api/vault/tree`, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
  const exit = exited(process);
  process.kill(signal);
  const result = await Promise.race([exit, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Shutdown timed out')), 3000))]);
  expect(result.code).toBe(0);
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}, 10000);

it('keeps the shell available when the configured file is missing', async () => {
  await rm(join(fixture, 'project', '.memory-loop', 'config.json'));
  const { base } = await startRuntime();
  const response = await fetch(`${base}/api/vault/tree`);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'config_missing' } });
  expect((await fetch(`${base}/recall`, { headers: { accept: 'text/html' } })).status).toBe(200);
}, 10000);

it('does not allow another loopback origin by default', async () => {
  const { base } = await startRuntime();
  expect((await fetch(`${base}/api/vault/tree`)).status).toBe(200);
  expect((await fetch(`${base}/api/vault/tree`, { headers: { origin: 'http://127.0.0.1:5173' } })).status).toBe(403);
}, 10000);

it('proxies actual Vite requests to Bun with only an explicitly permitted development origin', async () => {
  const daemonReservation = await reservePort();
  const viteReservation = await reservePort();
  const daemonPort = daemonReservation.port;
  const vitePort = viteReservation.port;
  await Promise.all([daemonReservation.listener, viteReservation.listener].map(listener =>
    new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))));
  const frontendOrigin = `http://127.0.0.1:${vitePort}`;
  const daemonOrigin = `http://127.0.0.1:${daemonPort}`;
  const previous = process.env.MEMORY_LOOP_DAEMON_URL;
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    process.env.MEMORY_LOOP_DAEMON_URL = daemonOrigin;
    try {
      vite = await createViteServer({
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        logLevel: 'silent', server: { host: '127.0.0.1', port: vitePort, strictPort: true },
      });
    } finally {
      if (previous === undefined) delete process.env.MEMORY_LOOP_DAEMON_URL;
      else process.env.MEMORY_LOOP_DAEMON_URL = previous;
    }
    await vite.listen();
    const daemonProcess = launch(daemonPort, frontendOrigin);
    await waitReady(daemonProcess, daemonPort);
    const tree = await fetch(`${frontendOrigin}/api/vault/tree`, { headers: { origin: frontendOrigin } });
    expect(tree.status).toBe(200);
    expect(tree.headers.get('cache-control')).toBe('no-store');
    expect(await tree.json()).toMatchObject({ entries: [{ name: 'folder', children: [{ name: 'note.md' }] }] });
    const query = new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) });
    const note = await fetch(`${frontendOrigin}/api/vault/note?${query}`, { headers: { origin: frontendOrigin } });
    expect(note.status).toBe(200);
    expect(await note.json()).toEqual({ name: 'note.md', markdown: '# fixture\n' });
    expect((await fetch(`${frontendOrigin}/api/vault/tree`, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(`${daemonOrigin}/api/vault/tree`)).status).toBe(200);
  } finally {
    await vite?.close();
  }
}, 15000);

it('accepts an explicitly configured localhost development origin', async () => {
  const { listener, port } = await reservePort();
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const process = launch(port, 'http://localhost:5173');
  await waitReady(process, port);
  expect((await fetch(`http://127.0.0.1:${port}/api/vault/tree`, { headers: { origin: 'http://localhost:5173' } })).status).toBe(200);
  expect((await fetch(`http://127.0.0.1:${port}/api/vault/tree`, { headers: { origin: 'http://localhost:5174' } })).status).toBe(403);
}, 10000);

it.each(['*', 'null', 'http://evil.example:5173', 'http://user:secret@localhost:5173',
  'https://localhost:5173', 'http://127.0.0.1:5173/path', 'not-an-origin'])(
  'fails safely for invalid development origin %s', async origin => {
    const { listener, port } = await reservePort();
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    const process = launch(port, origin);
    const result = await Promise.race([exited(process), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Invalid-origin startup timed out')), 5000))]);
    expect(result.code).not.toBe(0);
    expect(stderr).not.toContain(origin);
  }, 10000,
);

it('fails without replacing or interfering with an existing loopback listener', async () => {
  const { listener, port } = await reservePort();
  occupied = listener;
  const process = launch(port);
  const result = await Promise.race([exited(process), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Occupied-port startup timed out')), 5000))]);
  expect(result.code).not.toBe(0);
  expect(stderr).toMatch(/address.*in use|EADDRINUSE/i);
  expect(listener.listening).toBe(true);
}, 10000);
