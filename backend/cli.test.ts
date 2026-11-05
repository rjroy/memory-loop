import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const token = 'c'.repeat(64);
let root: string;
let server: Server | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-loop-cli-test-'));
  server = undefined;
  await mkdir(join(root, '.memory-loop'), { mode: 0o700 });
});
afterEach(async () => {
  try {
    if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
  } finally { await rm(root, { recursive: true, force: true }); }
});

function runScript(name: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['--no-env-file', 'run', '--cwd', packageRoot, name, '--project-root', root], {
      cwd: root, env: { ...process.env, MEMORY_LOOP_TRANSPORT_FILE: undefined }, stdio: 'pipe',
    });
    let output = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => { output += text; });
    child.stderr.on('data', (text: string) => { output += text; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Fixture CLI timed out')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

it('setup:transport creates credentials once without modifying vault config or printing the token', async () => {
  const vaultConfig = join(root, '.memory-loop', 'config.json');
  const fixtureConfig = '{"vaultDirectory":"/fixture-not-a-vault"}\n';
  await writeFile(vaultConfig, fixtureConfig);
  const first = await runScript('setup:transport');
  expect(first.code).toBe(0);
  const transportFile = join(root, '.memory-loop', 'transport.json');
  const tokenFile = join(root, '.memory-loop', 'service.token');
  const originalTransport = await readFile(transportFile, 'utf8');
  const originalToken = await readFile(tokenFile, 'utf8');
  expect(originalToken).toMatch(/^[a-f0-9]{64}$/);
  expect(first.output).not.toContain(originalToken);
  expect(first.output).not.toContain(root);
  const second = await runScript('setup:transport');
  expect(second.code).not.toBe(0);
  expect(second.output).not.toContain(originalToken);
  expect(second.output).not.toContain(root);
  expect(await readFile(transportFile, 'utf8')).toBe(originalTransport);
  expect(await readFile(tokenFile, 'utf8')).toBe(originalToken);
  expect(await readFile(vaultConfig, 'utf8')).toBe(fixtureConfig);
}, 15000);

async function checkFixture(body: string, contentType: string) {
  const requests: Array<{ method: string | undefined; url: string | undefined; authorization: string | undefined }> = [];
  server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { 'content-type': contentType });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => { server?.once('error', reject); server?.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected fixture TCP address');
  await writeFile(join(root, '.memory-loop', 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${address.port}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(root, '.memory-loop', 'service.token'), token, { mode: 0o600 });
  const result = await runScript('check:daemon');
  expect(requests).toEqual([{ method: 'GET', url: '/api/vault/tree', authorization: `Bearer ${token}` }]);
  expect(result.output).not.toContain(token);
  expect(result.output).not.toContain(root);
  return result;
}

it.each([
  { rootIdentity: 'root', entries: [{ kind: 'note', name: 'private-fixture-name.md', id: ['private-fixture-name.md'], identity: 'note-id', version: 'note-version' }] },
  { rootIdentity: 'root', entries: [] },
])('check:daemon accepts a valid fixture tree without printing its contents', async tree => {
  const result = await checkFixture(JSON.stringify(tree), 'application/json');
  expect(result.code).toBe(0);
  expect(result.output).toMatch(/200|ready|available/i);
  expect(result.output).not.toContain('private-fixture-name.md');
}, 10000);

it.each([
  ['HTML fallback', 'text/html', '<html>private-fixture-response</html>'],
  ['malformed JSON', 'application/json', '{"private-fixture-response":'],
  ['wrong tree shape', 'application/json', '{"entries":"private-fixture-response"}'],
] as const)('HN1-R1: check:daemon rejects HTTP 200 %s without exposing its body', async (_label, contentType, body) => {
  const result = await checkFixture(body, contentType);
  expect(result.code).not.toBe(0);
  expect(result.output).not.toContain('private-fixture-response');
}, 10000);
