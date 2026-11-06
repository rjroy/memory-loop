import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { openVault, type VaultReader } from './vault';
import type { VaultId } from './contract';

const authority = '127.0.0.1:3001';
const token = 'a'.repeat(64);
let fixture: string;
let root: string;
let reader: VaultReader;
let app: ReturnType<typeof createApp>;
let listed: VaultId[];

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-directory-test-'));
  root = join(fixture, 'vault');
  await mkdir(join(root, 'shelf', 'nested'), { recursive: true });
  await mkdir(join(root, 'other'));
  await writeFile(join(root, 'shelf', 'nested', 'deep.md'), 'fixture');
  await writeFile(join(root, 'shelf', 'first.md'), 'fixture');
  await writeFile(join(root, 'root.md'), 'fixture');
  listed = [];
  // The directory enumeration hook is an observation seam, not a mock: actual
  // descriptor-relative filesystem access and HTTP handling still run.
  const options: NonNullable<Parameters<typeof openVault>[1]> & {
    onDirectoryListed: (id: VaultId) => void;
  } = { onDirectoryListed: id => { listed.push([...id]); } };
  reader = await openVault(root, options);
  app = createApp({ authority, serviceToken: token, vault: { reader } });
});

afterEach(async () => {
  try { await reader?.close(); } finally { if (fixture) await rm(fixture, { recursive: true, force: true }); }
});

function directory(id: unknown) {
  const query = new URLSearchParams({ id: JSON.stringify(id) });
  return app(new Request(`http://${authority}/api/vault/directory?${query}`, {
    headers: { host: authority, authorization: `Bearer ${token}` },
  }));
}

it('lists just the requested directory without enumerating closed descendants', async () => {
  const response = await directory([]);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ rootIdentity: expect.any(String), entries: [
    { kind: 'directory', name: 'other', id: ['other'], identity: expect.any(String), version: expect.any(String) },
    { kind: 'note', name: 'root.md', id: ['root.md'], identity: expect.any(String), version: expect.any(String) },
    { kind: 'directory', name: 'shelf', id: ['shelf'], identity: expect.any(String), version: expect.any(String) },
  ] });
  expect(listed).toEqual([[]]);

  listed.length = 0;
  const shelf = await directory(['shelf']);
  expect(shelf.status).toBe(200);
  expect(await shelf.json()).toMatchObject({ entries: [
    { kind: 'note', name: 'first.md', id: ['shelf', 'first.md'] },
    { kind: 'directory', name: 'nested', id: ['shelf', 'nested'] },
  ] });
  expect(listed).toEqual([['shelf']]);
});

it('refreshes a directory after external creation and refuses parent traversal', async () => {
  const initial = await directory(['shelf']);
  expect(initial.status).toBe(200);
  await writeFile(join(root, 'shelf', 'added.md'), 'fixture');
  const refreshed = await directory(['shelf']);
  expect(refreshed.status).toBe(200);
  expect(await refreshed.json()).toMatchObject({ entries: expect.arrayContaining([
    expect.objectContaining({ kind: 'note', id: ['shelf', 'added.md'] }),
  ]) });
  expect((await directory(['..'])).status).toBe(400);
});

// Symlink fixtures need elevated privileges on Windows; link tests are POSIX-only.
it.skipIf(process.platform === 'win32')('refuses symlink traversal', async () => {
  expect((await directory(['shelf'])).status).toBe(200);
  await symlink(join(root, 'shelf'), join(root, 'link'));
  expect((await directory(['link'])).status).not.toBe(200);
});
