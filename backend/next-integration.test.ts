import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const next = join(root, 'node_modules/next/dist/bin/next');
const token = 'd'.repeat(64);
let fixture = '';
let upstream: Server;
let child: ChildProcessWithoutNullStreams;
let port: number;
let calls: Array<{ url: string | undefined; method: string | undefined; headers: IncomingHttpHeaders; body: string }> = [];
let output = '';
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: '', NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' };

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePort((server.address() as AddressInfo).port));
  });
}
function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}
function request(path: string, headers: Record<string, string> = {}, targetPort = port, method = 'GET', requestBody?: string) {
  return new Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: string }>((resolveRequest, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: targetPort, path, headers, method }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}
async function ready() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited before ready: ${output}`);
    try { await request('/'); return; } catch { await new Promise(resolveWait => setTimeout(resolveWait, 30)); }
  }
  throw new Error('Next did not become ready');
}

async function ownedNodeNext(rootPid: number) {
  const runnerExecutable = await realpath(process.execPath);
  let pathNode: string | undefined;
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    try {
      const candidate = resolve(fixture, directory || '.', 'node');
      await access(candidate, constants.X_OK);
      pathNode = await realpath(candidate);
      break;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR'))) throw error;
    }
  }
  if (!pathNode) throw new Error('Fixture PATH has no executable node');
  const result = { owned: false, descendantObserved: false, executableMatched: false, nextCommandMatched: false,
    vanishedProc: false, pathNodeFound: true, pathNodeMatchesRunner: pathNode === runnerExecutable,
    runnerIsBun: typeof process.versions.bun === 'string', traversalTruncated: false };
  const pending = [rootPid];
  let visited = 0;
  while (pending.length && visited < 256) {
    const pid = pending.pop();
    if (pid === undefined) break;
    visited++;
    if (pid !== rootPid) result.descendantObserved = true;
    try {
      const [executable, args, children] = await Promise.all([
        realpath(`/proc/${pid}/exe`),
        readFile(`/proc/${pid}/cmdline`, 'utf8'),
        readFile(`/proc/${pid}/task/${pid}/children`, 'utf8'),
      ]);
      const executableMatched = executable === pathNode;
      const nextCommandMatched = /next-server|next\/dist\/bin\/next/.test(args);
      result.executableMatched ||= executableMatched;
      result.nextCommandMatched ||= nextCommandMatched;
      result.owned ||= executableMatched && nextCommandMatched;
      for (const child of children.trim().split(/\s+/)) if (/^\d+$/.test(child)) pending.push(Number(child));
    } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
      result.vanishedProc = true;
    }
  }
  result.traversalTruncated = pending.length > 0;
  return result;
}

describe('production Next HTTP boundary', () => {
  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'recall-next-test-'));
    const project = join(fixture, 'project');
    await mkdir(project);
    await cp(join(root, 'src'), join(project, 'src'), { recursive: true });
    await cp(join(root, 'backend'), join(project, 'backend'), { recursive: true });
    await cp(join(root, 'public'), join(project, 'public'), { recursive: true });
    await cp(join(root, 'package.json'), join(project, 'package.json'));
    await cp(join(root, 'tsconfig.json'), join(project, 'tsconfig.json'));
    await cp(join(root, 'next.config.ts'), join(project, 'next.config.ts'));
    await cp(join(root, 'bunfig.toml'), join(project, 'bunfig.toml'));
    await symlink(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
    const build = spawnSync(process.execPath, [next, 'build', project, '--webpack'], { cwd: fixture, env: { ...env, HOME: fixture }, encoding: 'utf8', timeout: 120_000 });
    if (build.status !== 0) throw new Error(`Fixture Next build failed: ${build.stdout}\n${build.stderr}`);
    upstream = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        calls.push({ url: req.url, method: req.method, headers: req.headers, body });
        if (req.url?.startsWith('/api/think/conversations')) {
          if (body.includes('44444444-4444-4444-8444-444444444444')) { res.destroy(); return; }
          const conversationId = '11111111-1111-4111-8111-111111111111';
          const clientCommandId = '22222222-2222-4222-8222-222222222222';
          const epoch = '33333333-3333-4333-8333-333333333333';
          const receipt = { kind: 'create', conversationId, clientCommandId, epoch, state: 'registered' };
          const state = { conversationId, epoch, revision: 1, creation: 'ready' };
          res.writeHead(req.method === 'POST' ? 202 : 200, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
          res.end(JSON.stringify(req.url.includes('/commands/') || req.method === 'POST' ? receipt : state));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
        res.end(JSON.stringify(req.url?.startsWith('/api/vault/note') ? { name: 'fixture.md', markdown: '# fixture' } : { entries: [] }));
      });
    });
    const upstreamPort = await listen(upstream);
    const reservation = createServer();
    port = await listen(reservation);
    await close(reservation);
    const metadata = join(fixture, 'metadata');
    await mkdir(metadata, { mode: 0o700 });
    await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
    await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${upstreamPort}`, web: { mode: 'loopback', origin: `http://127.0.0.1:${port}` } }), { mode: 0o600 });
    child = spawn(process.execPath, [next, 'start', project, '--hostname', '127.0.0.1', '--port', String(port)], { cwd: fixture, env: { ...env, HOME: fixture, MEMORY_LOOP_TRANSPORT_FILE: join(metadata, 'transport.json') }, stdio: 'pipe' });
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    await ready();
  }, 150_000);
  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
      child.kill('SIGTERM');
      await exited;
    }
    if (upstream?.listening) await close(upstream);
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });
  it('relays tree with server-only authorization and projects safe headers', async () => {
    calls = [];
    const response = await request('/api/vault/tree', { origin: `http://127.0.0.1:${port}`, authorization: 'Bearer browser-secret', cookie: 'session=fixture' });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ entries: [] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[0].headers.cookie).toBeUndefined();
    expect(response.body + JSON.stringify(response.headers) + output).not.toContain(token);
  });
  it('forwards fixed Think create, state and receipt routes with fresh daemon credentials', async () => {
    calls = [];
    const conversationId = '11111111-1111-4111-8111-111111111111';
    const clientCommandId = '22222222-2222-4222-8222-222222222222';
    const base = `/api/think/conversations/${conversationId}`;
    const body = JSON.stringify({ conversationId, clientCommandId });
    const create = await request('/api/think/conversations', { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', authorization: 'Bearer browser-secret', cookie: 'session=fixture' }, port, 'POST', body);
    expect(create.status).toBe(202);
    expect(JSON.parse(create.body)).toMatchObject({ kind: 'create', conversationId, clientCommandId, state: 'registered' });
    expect(create.headers['set-cookie']).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: '/api/think/conversations', method: 'POST', body });
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[0].headers.cookie).toBeUndefined();
    const state = await request(base);
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body)).toMatchObject({ conversationId, creation: 'ready' });
    const receipt = await request(`${base}/commands/${clientCommandId}`);
    expect(receipt.status).toBe(200);
    expect(JSON.parse(receipt.body)).toMatchObject({ kind: 'create', conversationId, clientCommandId });
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['POST', '/api/think/conversations'], ['GET', base], ['GET', `${base}/commands/${clientCommandId}`],
    ]);
    expect(create.body + state.body + receipt.body + output).not.toContain(token);
  });
  it.each<Record<string, string>>([{ host: 'hostile.example', 'x-forwarded-host': '127.0.0.1' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])('rejects Think command policy violations before forwarding %o', async headers => {
    calls = [];
    const response = await request('/api/think/conversations', { ...headers, 'content-type': 'application/json' }, port, 'POST', JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '22222222-2222-4222-8222-222222222222' }));
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('does not retry a Think POST after an ambiguous upstream connection loss', async () => {
    calls = [];
    const body = JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '44444444-4444-4444-8444-444444444444' });
    const response = await request('/api/think/conversations', { 'content-type': 'application/json' }, port, 'POST', body);
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', body });
  });
  it('forwards exactly encoded note identifier on the fixed route', async () => {
    calls = [];
    const id = ['folder', 'a % &.md'];
    const response = await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(id) })}`);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ name: 'fixture.md', markdown: '# fixture' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url ?? '', 'http://127.0.0.1').searchParams.getAll('id')).toEqual([JSON.stringify(id)]);
  });
  it.each<Record<string, string>>([{ host: 'hostile.example', 'x-forwarded-host': '127.0.0.1' }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }])('denies real HTTP hostile headers %o without upstream', async headers => {
    calls = [];
    const response = await request('/api/vault/tree', headers);
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('hard-load HTML does not reveal the service token', async () => {
    const response = await request('/recall');
    expect(response.status).toBe(200);
    expect(response.body + JSON.stringify(response.headers) + output).not.toContain(token);
  });
  it('does not embed the fixture token in production static bundles', async () => {
    const directory = join(fixture, 'project', '.next', 'static');
    let checked = 0;
    async function scan(path: string): Promise<void> {
      for (const item of await readdir(path, { withFileTypes: true })) {
        const childPath = join(path, item.name);
        if (item.isDirectory()) await scan(childPath);
        else if (item.isFile()) {
          checked++;
          expect((await readFile(childPath)).includes(Buffer.from(token))).toBe(false);
        }
      }
    }
    await scan(directory);
    expect(checked).toBeGreaterThan(0);
  });
  it('starts and stops the canonical server package entrypoint from an unrelated directory', async () => {
    const reservation = createServer();
    const serverPort = await listen(reservation);
    await close(reservation);
    const metadata = join(fixture, 'server-metadata');
    await mkdir(metadata, { mode: 0o700 });
    await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
    const upstreamPort = (upstream.address() as AddressInfo).port;
    await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${upstreamPort}`, web: { mode: 'loopback', origin: `http://127.0.0.1:${serverPort}` } }), { mode: 0o600 });
    const server = spawn('bun', ['--no-env-file', 'run', '--cwd', join(fixture, 'project'), 'server', '--port', String(serverPort)], {
      cwd: fixture, env: { ...env, HOME: fixture, MEMORY_LOOP_TRANSPORT_FILE: join(metadata, 'transport.json') }, detached: true, stdio: 'pipe',
    });
    let logs = '';
    server.stdout.on('data', data => { logs += String(data); });
    server.stderr.on('data', data => { logs += String(data); });
    const exited = new Promise<void>((resolveExit, reject) => {
      server.once('exit', () => resolveExit());
      server.once('error', reject);
    });
    try {
      const deadline = Date.now() + 15_000;
      let response: Awaited<ReturnType<typeof request>> | undefined;
      while (Date.now() < deadline) {
        if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Server script exited before readiness: ${logs}`);
        try { response = await request('/recall', {}, serverPort); break; }
        catch { await new Promise(resolveWait => setTimeout(resolveWait, 30)); }
      }
      expect(response, `Server script did not become ready: ${logs}`).toBeDefined();
      expect(response?.status).toBe(200);
      expect(response?.headers['content-type']).toContain('text/html');
      expect((response?.body ?? '') + logs).not.toContain(token);
      if (server.pid === undefined) throw new Error('Owned server process has no PID');
      const ownership = await ownedNodeNext(server.pid);
      const launcherState = server.exitCode !== null ? 'exited' : server.signalCode !== null ? 'signalled' : 'running';
      expect(ownership.owned, `owned Next process not found: ${JSON.stringify({ ...ownership, launcherState })}`).toBe(true);
      process.kill(-server.pid, 'SIGTERM');
      await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server did not stop')), 5000))]);
      const check = createServer();
      try {
        await new Promise<void>((resolveListen, reject) => {
          check.once('error', reject);
          check.listen(serverPort, '127.0.0.1', resolveListen);
        });
      } finally { if (check.listening) await close(check); }
    } finally {
      if (server.pid !== undefined) {
        try { process.kill(-server.pid, 'SIGKILL'); }
        catch (error: unknown) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error;
        }
      }
      if (server.exitCode === null && server.signalCode === null) await exited;
    }
  }, 30_000);
});
