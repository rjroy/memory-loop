import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entrypoint = fileURLToPath(new URL('./runtime.ts', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
let fixture: string;
let child: ChildProcessWithoutNullStreams | undefined;
let ownedScriptGroup: number | undefined;
let occupied: Server | undefined;
let stderr: string;
let stdout: string;
const token = 'a'.repeat(64);

function setTransport(port: number) {
  writeFileSync(join(fixture, 'project', '.memory-loop', 'transport.json'), JSON.stringify({
    daemonOrigin: `http://127.0.0.1:${port}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' },
  }), { mode: 0o600 });
}

beforeEach(async () => {
  child = undefined;
  ownedScriptGroup = undefined;
  occupied = undefined;
  stderr = '';
  stdout = '';
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-runtime-test-'));
  await mkdir(join(fixture, 'project', '.memory-loop'), { recursive: true, mode: 0o700 });
  await mkdir(join(fixture, 'vault', 'folder'), { recursive: true });
  await writeFile(join(fixture, 'vault', 'folder', 'note.md'), '# fixture\n');
  await writeFile(join(fixture, 'project', '.memory-loop', 'config.json'),
    JSON.stringify({ vaultDirectory: join(fixture, 'vault') }));
  await writeFile(join(fixture, 'project', '.memory-loop', 'service.token'), token, { mode: 0o600 });
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

function launch(port: number, configure = true): ChildProcessWithoutNullStreams {
  if (configure) setTransport(port);
  const process = spawn('bun', ['--no-env-file', entrypoint, '--project-root', join(fixture, 'project'),
    '--port', String(port)], {
    cwd: fixture, env: { ...globalThis.process.env, MEMORY_LOOP_TRANSPORT_FILE: undefined }, stdio: 'pipe',
  });
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', (data: string) => { stderr += data; });
  process.stdout.setEncoding('utf8');
  process.stdout.on('data', (data: string) => { stdout += data; });
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
      const response = await serviceRequest(port, '/api/vault/tree', { authorization: `Bearer ${token}` });
      if (response.status === 200 || response.status === 503) return;
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

function serviceRequest(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, headers }, response => {
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

function requestWithHost(port: number, host: string) {
  return serviceRequest(port, '/api/vault/tree', { host, authorization: `Bearer ${token}` });
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
  setTransport(port);
  const process = spawn('bun', ['--no-env-file', 'run', 'daemon', '--project-root', join(fixture, 'project'),
    '--port', String(port)],
  { cwd: packageRoot, detached: true, env: { ...globalThis.process.env, MEMORY_LOOP_TRANSPORT_FILE: undefined }, stdio: 'pipe' });
  child = process;
  if (process.pid === undefined) throw new Error('Could not start test-owned daemon script');
  ownedScriptGroup = process.pid;
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', (text: string) => { stderr += text; });
  process.stdout.resume();
  await waitReady(process, port);
  const tree = await serviceRequest(port, '/api/vault/tree', { authorization: `Bearer ${token}` });
  expect(tree.status).toBe(200);
  expect(JSON.parse(tree.body)).toMatchObject({ entries: [{ name: 'folder', children: [{ name: 'note.md' }] }] });
  const note = await serviceRequest(port, `/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) })}`, { authorization: `Bearer ${token}` });
  expect(JSON.parse(note.body)).toEqual({ name: 'note.md', markdown: '# fixture\n', revision: expect.stringMatching(/^[a-f0-9]{64}$/), editable: true });
  expect((await serviceRequest(port, '/recall', { authorization: `Bearer ${token}` })).status).toBe(404);

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

it.each(['SIGTERM', 'SIGINT'] as const)('serves fixture API, rejects untrusted host/origin, and shuts down on %s', async signal => {
  const { process, port } = await startRuntime();
  const tree = await serviceRequest(port, '/api/vault/tree', { authorization: `Bearer ${token}` });
  expect(tree.status).toBe(200);
  expect(JSON.parse(tree.body)).toMatchObject({ entries: [{ name: 'folder', children: [{ name: 'note.md' }] }] });
  const note = await serviceRequest(port, `/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) })}`, { authorization: `Bearer ${token}` });
  expect(JSON.parse(note.body)).toEqual({ name: 'note.md', markdown: '# fixture\n', revision: expect.stringMatching(/^[a-f0-9]{64}$/), editable: true });
  expect((await serviceRequest(port, '/recall', { authorization: `Bearer ${token}` })).status).toBe(404);
  expect((await requestWithHost(port, 'evil.example')).status).toBe(403);
  expect((await serviceRequest(port, '/api/vault/tree', { origin: 'http://evil.example', authorization: `Bearer ${token}` })).status).toBe(403);
  expect((await serviceRequest(port, '/api/vault/tree')).status).toBe(401);
  const exit = exited(process);
  process.kill(signal);
  const result = await Promise.race([exit, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Shutdown timed out')), 3000))]);
  expect(result.code).toBe(0);
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}, 10000);

it('keeps the API available with a clear error when configuration is missing', async () => {
  await rm(join(fixture, 'project', '.memory-loop', 'config.json'));
  const { port } = await startRuntime();
  const response = await serviceRequest(port, '/api/vault/tree', { authorization: `Bearer ${token}` });
  expect(response.status).toBe(503);
  expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'config_missing' } });
  expect((await serviceRequest(port, '/recall', { authorization: `Bearer ${token}` })).status).toBe(404);
}, 10000);

it('uses the configured daemon origin port when no CLI port override is supplied', async () => {
  const { listener, port } = await reservePort();
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  setTransport(port);
  const process = spawn('bun', ['--no-env-file', entrypoint, '--project-root', join(fixture, 'project')], {
    cwd: fixture, env: { ...globalThis.process.env, MEMORY_LOOP_TRANSPORT_FILE: undefined }, stdio: 'pipe',
  });
  child = process;
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', (text: string) => { stderr += text; });
  process.stdout.resume();
  await waitReady(process, port);
  expect((await serviceRequest(port, '/api/vault/tree', { authorization: `Bearer ${token}` })).status).toBe(200);
}, 10000);

it('does not allow another loopback origin by default', async () => {
  const { port } = await startRuntime();
  expect((await serviceRequest(port, '/api/vault/tree', { authorization: `Bearer ${token}` })).status).toBe(200);
  expect((await serviceRequest(port, '/api/vault/tree', { origin: 'http://127.0.0.1:5173', authorization: `Bearer ${token}` })).status).toBe(403);
}, 10000);

it('fails without replacing or interfering with an existing loopback listener', async () => {
  const { listener, port } = await reservePort();
  occupied = listener;
  const process = launch(port);
  const result = await Promise.race([exited(process), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Occupied-port startup timed out')), 5000))]);
  expect(result.code).not.toBe(0);
  expect(stderr).toMatch(/address.*in use|EADDRINUSE/i);
  expect(listener.listening).toBe(true);
}, 10000);

it.each(['missing token', 'bad token', 'bad transport', 'port mismatch'] as const)(
  'fails safely before binding for %s', async problem => {
    const { listener, port } = await reservePort();
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    setTransport(problem === 'port mismatch' ? (port === 65535 ? port - 1 : port + 1) : port);
    const metadata = join(fixture, 'project', '.memory-loop');
    if (problem === 'missing token') await rm(join(metadata, 'service.token'));
    if (problem === 'bad token') await writeFile(join(metadata, 'service.token'), 'invalid');
    if (problem === 'bad transport') await writeFile(join(metadata, 'transport.json'), '{');
    const process = launch(port, false);
    const result = await Promise.race([exited(process), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Startup failure timed out')), 5000))]);
    expect(result.code).not.toBe(0);
    expect(stderr).toMatch(problem === 'port mismatch' ? /port|mismatch/i : /transport|credential|token/i);
    expect(stderr).not.toContain(token);
    expect(stderr).not.toContain(fixture);
    expect(stderr).not.toContain('note.md');
    expect(stdout).not.toContain(token);
    expect(stdout).not.toContain(fixture);
    expect(stdout).not.toContain('note.md');
    const probe = createServer();
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }, 10000,
);
