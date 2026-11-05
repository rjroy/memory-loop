import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openGround, type GroundReader } from './ground';

let root: string;
let vault: string;
let reader: GroundReader | undefined;
const directory = ['03_Resources', 'Memory-Loop'];
const path = (name: string) => join(vault, ...directory, name);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ground-reader-test-'));
  vault = join(root, 'vault');
  await mkdir(join(vault, ...directory), { recursive: true });
});
afterEach(async () => {
  try { await reader?.close(); } finally { reader = undefined; await rm(root, { recursive: true, force: true }); }
});

describe('Ground resource reader', () => {
  it('hashes actual BOM/CRLF source bytes while parsing the same content', async () => {
    const raw = '\uFEFF# Fixture\r\n\r\n## Question\r\nA fixture\r\nquestion\r\n';
    await writeFile(path('prompts.md'), raw);
    const draw = vi.fn(() => 0);
    reader = await openGround(vault, undefined, draw);
    const result = await reader.resource('prompts');
    expect(result).toMatchObject({ state: 'ready', revision: createHash('sha256').update(raw).digest('hex'), data: { question: { text: 'A fixture question' } } });
    expect(draw).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('applies valid custom paths while isolating invalid and duplicate paths', async () => {
    await writeFile(path('custom.md'), '# Fixture goal');
    await writeFile(path('inspiration.md'), '');
    reader = await openGround(vault, { resources: { quickActions: '../outside.md', prompts: '03_Resources/Memory-Loop/inspiration.md', goals: '03_Resources/Memory-Loop/custom.md' } });
    expect(await reader.resource('quickActions')).toEqual({ state: 'unavailable', reason: 'configuration' });
    expect(await reader.resource('prompts')).toEqual({ state: 'unavailable', reason: 'configuration' });
    expect(await reader.resource('inspiration')).toEqual({ state: 'unavailable', reason: 'configuration' });
    expect(await reader.resource('goals')).toMatchObject({ state: 'ready', noteId: [...directory, 'custom.md'], data: { markdown: '# Fixture goal' } });
  });
  it.skipIf(process.platform === 'win32')('does not follow an intermediate directory symlink', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'goals.md'), 'private fixture');
    await symlink(outside, path('linked'));
    reader = await openGround(vault, { resources: { goals: '03_Resources/Memory-Loop/linked/goals.md' } });
    const result = await reader.resource('goals');
    expect(result).toMatchObject({ state: 'unavailable', reason: 'io' });
    expect(JSON.stringify(result)).not.toContain('private fixture');
    expect(JSON.stringify(result)).not.toContain(root);
  });
  it('fails closed for a directory resource', async () => {
    await mkdir(path('goals.md'));
    reader = await openGround(vault);
    expect(await reader.resource('goals')).toMatchObject({ state: 'unavailable', reason: 'io' });
  });
  it('reads a hardlinked resource without modifying its alias', async () => {
    await writeFile(join(root, 'other.md'), '# fixture goal');
    await link(join(root, 'other.md'), path('goals.md'));
    reader = await openGround(vault);
    expect(await reader.resource('goals')).toMatchObject({ state: 'ready', data: { markdown: '# fixture goal' } });
    expect(await readFile(join(root, 'other.md'), 'utf8')).toBe('# fixture goal');
  });

  it.skipIf(process.platform === 'win32')('canonicalizes a configured root symlink', async () => {
    await writeFile(path('goals.md'), '# linked root');
    const alias = join(root, 'vault-link');
    await symlink(vault, alias, 'dir');
    reader = await openGround(alias);
    expect(await reader.resource('goals')).toMatchObject({ state: 'ready', data: { markdown: '# linked root' } });
  });

  it('refuses resources and captures after a detectable root replacement', async () => {
    await writeFile(path('goals.md'), '# original');
    await mkdir(join(vault, '00_Inbox'));
    await writeFile(join(vault, '00_Inbox', '2026-02-01.md'), '- [09:10] original\n');
    reader = await openGround(vault);
    const original = join(root, 'original-vault');
    await rename(vault, original);
    await mkdir(join(vault, ...directory), { recursive: true });
    await writeFile(path('goals.md'), '# replacement');
    await mkdir(join(vault, '00_Inbox'));
    await writeFile(join(vault, '00_Inbox', '2026-02-01.md'), '- [09:10] replacement\n');
    expect(await reader.resource('goals')).toMatchObject({ state: 'unavailable', reason: 'io' });
    expect(await reader.captures()).toMatchObject({ state: 'unavailable', reason: 'io' });
    expect(await readFile(path('goals.md'), 'utf8')).toBe('# replacement');
    expect(await readFile(join(original, ...directory, 'goals.md'), 'utf8')).toBe('# original');
  });

  it.skipIf(process.platform === 'win32')('reads existing configured host-valid nonportable resource names', async () => {
    await writeFile(path('CON.md'), '# legacy');
    reader = await openGround(vault, { resources: { goals: '03_Resources/Memory-Loop/CON.md' } });
    expect(await reader.resource('goals')).toMatchObject({ state: 'ready', data: { markdown: '# legacy' } });
  });

  it.skipIf(process.platform !== 'win32')('accepts a root junction but rejects a descendant junction', async () => {
    await writeFile(path('goals.md'), '# fixture');
    const alias = join(root, 'vault-link');
    await symlink(vault, alias, 'junction');
    reader = await openGround(alias);
    expect(await reader.resource('goals')).toMatchObject({ state: 'ready', data: { markdown: '# fixture' } });
    await reader.close();
    reader = undefined;
    reader = await openGround(alias, { resources: { goals: '03_Resources/Memory-Loop/link/goals.md' } });
    await symlink(join(vault, ...directory), path('link'), 'junction');
    expect(await reader.resource('goals')).toMatchObject({ state: 'unavailable', reason: 'io' });
  });
  it.skipIf(process.platform === 'win32')('reports an unreadable resource without suppressing an independent sibling', async () => {
    await writeFile(path('goals.md'), '# fixture');
    await symlink(join(root, 'absent'), path('prompts.md'));
    reader = await openGround(vault);
    expect(await reader.resource('prompts')).toMatchObject({ state: 'unavailable', reason: 'io' });
    expect(await reader.resource('goals')).toMatchObject({ state: 'ready', data: { markdown: '# fixture' } });
  });
});

describe('recent capture source coverage', () => {
  it('returns partial coverage for invalid times while retaining ordered multiline captures', async () => {
    await mkdir(join(vault, '00_Inbox'));
    await writeFile(join(vault, '00_Inbox', '2026-02-01.md'), '- [09:10] first\r\n  continuation\r\n  \r\n  final\r\n- [25:00] invalid fixture\r\n- [09:10] second\r\n');
    reader = await openGround(vault);
    const result = await reader.captures();
    expect(result).toMatchObject({ state: 'ready', coverage: 'partial', items: [
      { localDateTime: '2026-02-01T09:10', excerpt: 'second' },
      { localDateTime: '2026-02-01T09:10', excerpt: 'first\ncontinuation\n\nfinal' },
    ] });
  });
  it('reports malformed coverage rather than empty when no valid capture can be established', async () => {
    await mkdir(join(vault, '00_Inbox'));
    await writeFile(join(vault, '00_Inbox', '2026-02-01.md'), '- [12:99] invalid fixture\n');
    reader = await openGround(vault);
    expect(await reader.captures()).toEqual({ state: 'malformed', issue: { code: 'source_coverage' } });
  });
  it.skipIf(process.platform === 'win32')('marks a valid newer capture partial when an older date-named source cannot be read', async () => {
    const inbox = join(vault, '00_Inbox');
    await mkdir(inbox);
    await writeFile(join(inbox, '2026-02-02.md'), '- [08:00] valid fixture\n');
    await symlink(join(root, 'outside'), join(inbox, '2026-02-01.md'));
    reader = await openGround(vault);
    expect(await reader.captures()).toMatchObject({ state: 'ready', coverage: 'partial', items: [{ excerpt: 'valid fixture' }] });
  });
  it('marks a valid newer capture partial when an older source exceeds the scan budget', async () => {
    const inbox = join(vault, '00_Inbox');
    await mkdir(inbox);
    await writeFile(join(inbox, '2026-02-02.md'), '- [08:00] valid fixture\n');
    await writeFile(join(inbox, '2026-02-01.md'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
    reader = await openGround(vault);
    expect(await reader.captures()).toMatchObject({ state: 'ready', coverage: 'partial', items: [{ excerpt: 'valid fixture' }] });
  });
});
