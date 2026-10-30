import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareServer, type PreparedServer } from './server';

const authority = '127.0.0.1:31234';
let fixture: string;
let projectRoot: string;
let distDirectory: string;
let vault: string;
let server: PreparedServer | undefined;

beforeEach(async () => {
  server = undefined;
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-server-test-'));
  projectRoot = join(fixture, 'app');
  distDirectory = join(fixture, 'dist');
  vault = join(fixture, 'vault');
  await mkdir(join(projectRoot, '.memory-loop'), { recursive: true });
  await mkdir(join(distDirectory, 'assets'), { recursive: true });
  await mkdir(join(vault, 'folder'), { recursive: true });
  await writeFile(join(distDirectory, 'index.html'), '<!doctype html><title>Fixture app</title>');
  await writeFile(join(distDirectory, 'assets', 'app.js'), 'fixture javascript');
  await writeFile(join(vault, 'folder', 'note.md'), '# Fixture note\n');
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault }));
});

afterEach(async () => {
  try {
    await server?.close();
  } finally {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  }
});

async function start() {
  const prepared = await prepareServer({ projectRoot, distDirectory, authority, allowedOrigins: [`http://${authority}`] });
  server = prepared;
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', authority);
    return prepared.fetch(new Request(`http://${authority}${path}`, { ...init, headers }));
  };
}

it('loads fixture config once and serves the real tree and selected note through the API', async () => {
  const request = await start();
  const tree = await request('/api/vault/tree');
  expect(tree.status).toBe(200);
  expect(tree.headers.get('cache-control')).toBe('no-store');
  expect(await tree.json()).toEqual({ entries: [{ kind: 'directory', name: 'folder', id: ['folder'], children: [
    { kind: 'note', name: 'note.md', id: ['folder', 'note.md'] },
  ] }] });
  const note = await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) })}`);
  expect(note.status).toBe(200);
  expect(await note.json()).toEqual({ name: 'note.md', markdown: '# Fixture note\n' });
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), '{');
  expect((await request('/api/vault/tree')).status).toBe(200);
});

it.each(['missing', 'invalid'] as const)('serves a clear %s config error and still serves the shell', async kind => {
  const config = join(projectRoot, '.memory-loop', 'config.json');
  if (kind === 'missing') await rm(config);
  else await writeFile(config, '{');
  const request = await start();
  const response = await request('/api/vault/tree');
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ error: { code: kind === 'missing' ? 'config_missing' : 'config_invalid' } });
  expect((await request('/recall', { headers: { accept: 'text/html' } })).status).toBe(200);
});

it('serves built assets and a direct frontend navigation from the fixture dist', async () => {
  const request = await start();
  const asset = await request('/assets/app.js');
  expect(asset.status).toBe(200);
  expect(await asset.text()).toBe('fixture javascript');
  const page = await request('/recall', { headers: { accept: 'text/html' } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Fixture app');
});

it('does not use SPA fallback for missing assets or API routes', async () => {
  const request = await start();
  expect((await request('/assets/missing.js', { headers: { accept: 'text/html' } })).status).toBe(404);
  expect((await request('/api/missing', { headers: { accept: 'text/html' } })).status).toBe(404);
});

it('applies Host checks and rejects unsafe methods to static requests', async () => {
  const request = await start();
  expect((await request('/recall', { headers: { host: 'attacker.example:31234', accept: 'text/html' } })).status).toBe(403);
  expect((await request('/recall', { method: 'POST', headers: { accept: 'text/html' } })).status).toBe(405);
});

it('does not expose dotfiles, outside files through symlinks, encoded traversal or the vault as static files', async () => {
  await writeFile(join(distDirectory, '.private'), 'secret sentinel');
  await writeFile(join(fixture, 'secret.txt'), 'secret sentinel');
  await symlink(join(fixture, 'secret.txt'), join(distDirectory, 'escape.txt'));
  const request = await start();
  for (const path of ['/.private', '/escape.txt', '/assets/%2e%2e%2fsecret.txt', '/folder/note.md']) {
    const response = await request(path);
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('secret sentinel');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  }
});
