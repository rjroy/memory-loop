import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';

vi.mock('server-only', () => ({}));
import { vaultRoute } from './vault-route';

const token = 'a'.repeat(64);
const previous = process.env.MEMORY_LOOP_TRANSPORT_FILE;
let fixture: string;
let root: string;
let child: ChildProcessWithoutNullStreams | undefined;
let authority: string;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'j21-empty-bun-'));
  root = join(fixture, 'vault');
  const metadata = join(fixture, 'private');
  await mkdir(root);
  await mkdir(metadata, { mode: 0o700 });
  const resolved = spawnSync('bun', ['--no-env-file', '-e', 'process.stdout.write(process.execPath)'], { encoding: 'utf8' });
  if (resolved.error || resolved.status !== 0 || !isAbsolute(resolved.stdout)) {
    throw new Error(`Could not resolve Bun executable: ${resolved.error?.message ?? resolved.stderr}`);
  }
  const processHandle = spawn(resolved.stdout, ['--no-env-file', 'backend/upload-empty.fixture.ts', root], {
    cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', HOME: fixture, NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child = processHandle;
  let stderr = '';
  processHandle.stderr.setEncoding('utf8');
  processHandle.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
  const lines = createInterface({ input: processHandle.stdout });
  const port = await new Promise<number>((resolve, reject) => {
    lines.on('line', line => {
      const match = /^UPLOAD_FIXTURE_READY (\d+)$/.exec(line);
      if (match) resolve(Number(match[1]));
    });
    child?.once('error', reject);
    processHandle.once('close', code => reject(new Error(`Owned daemon exited before ready (${code}): ${stderr}`)));
  });
  authority = `127.0.0.1:${port}`;
  await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://${authority}` }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
  process.env.MEMORY_LOOP_TRANSPORT_FILE = join(metadata, 'transport.json');
});
afterEach(async () => {
  if (previous === undefined) delete process.env.MEMORY_LOOP_TRANSPORT_FILE;
  else process.env.MEMORY_LOOP_TRANSPORT_FILE = previous;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  child = undefined;
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

function daemon(method: string, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const upstream = request(`http://${authority}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    upstream.on('error', reject);
    upstream.end();
  });
}

describe('zero-byte uploads through owned Bun daemon HTTP', () => {
  it('rejects Node HTTP Content-Length: 0 without publishing a file', async () => {
    const limits = await daemon('GET', '/api/vault/attachments');
    expect(limits.status).toBe(200);
    expect(JSON.parse(limits.body)).toEqual({ maxFileBytes: 100 * 1024 * 1024 });
    const result = await daemon('POST', '/api/vault/attachments?name=direct.bin', { 'content-type': 'application/octet-stream', 'content-length': '0' });
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(join(root, '06_Attachments')).catch(() => [])).toEqual([]);
  }, 10_000);
  it('rejects a null-body zero-length web request through the actual route', async () => {
    const req = new Request('http://127.0.0.1:3000/api/vault/attachments?name=web.bin', {
      method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/octet-stream', 'content-length': '0' },
    });
    expect(req.body).toBeNull();
    const result = await vaultRoute(req);
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(join(root, '06_Attachments')).catch(() => [])).toEqual([]);
  }, 10_000);
  it('rejects an empty chunked request through Bun and through the actual web route', async () => {
    const direct = await daemon('POST', '/api/vault/attachments?name=direct.bin', { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' });
    expect(direct.status).toBe(400);
    expect(JSON.parse(direct.body)).toMatchObject({ error: { code: 'invalid_request' } });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/octet-stream' }, body, duplex: 'half' };
    const web = await vaultRoute(new Request('http://127.0.0.1:3000/api/vault/attachments?name=web.bin', init));
    expect(web.status).toBe(400);
    expect(await web.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(join(root, '06_Attachments')).catch(() => [])).toEqual([]);
  }, 10_000);
  it('still rejects malformed names, wrong content types and unsupported methods', async () => {
    const headers = { 'content-type': 'application/octet-stream', 'content-length': '0' };
    const unsafe = await daemon('POST', '/api/vault/attachments?name=..', headers);
    expect(unsafe.status).toBe(400);
    expect(JSON.parse(unsafe.body)).toMatchObject({ error: { code: 'invalid_request' } });
    const wrongType = await daemon('POST', '/api/vault/attachments?name=empty.bin', { 'content-type': 'text/plain', 'content-length': '0' });
    expect(wrongType.status).toBe(400);
    const wrongMethod = await daemon('PUT', '/api/vault/attachments?name=empty.bin', headers);
    expect(wrongMethod.status).toBe(405);
  }, 10_000);
});
