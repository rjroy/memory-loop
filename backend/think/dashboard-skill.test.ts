import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installDashboardSkill } from './dashboard-skill';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
let root: string;
let vault: string;
let app: string;
let skillDir: string;
let skill: string;
let manifest: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dashboard-skill-test-'));
  vault = join(root, 'external-vault');
  app = join(root, 'application');
  outside = join(root, 'outside');
  await Promise.all([mkdir(vault), mkdir(join(app, '.memory-loop'), { recursive: true }), mkdir(outside)]);
  skillDir = join(vault, '.opencode', 'skills', 'memory-loop-dashboard-setup');
  skill = join(skillDir, 'SKILL.md');
  manifest = join(app, '.memory-loop', `dashboard-skill-${hash(await realpath(vault))}.json`);
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function oldManagedSkill(content: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(skill, content);
  await writeFile(manifest, JSON.stringify({ digest: hash(content) }) + '\n');
}

it('installs the actual bundle into an external vault and makes repeated installation a no-op', async () => {
  const bundle = await readFile(new URL('./dashboard-skill/SKILL.md', import.meta.url));
  expect(await installDashboardSkill(vault, app)).toBe('installed');
  expect(await readFile(skill)).toEqual(bundle);
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual({ digest: hash(bundle) });
  const before = await lstat(skill, { bigint: true });
  const recordBefore = await lstat(manifest, { bigint: true });
  expect(await installDashboardSkill(vault, app)).toBe('unchanged');
  const after = await lstat(skill, { bigint: true });
  const recordAfter = await lstat(manifest, { bigint: true });
  expect([after.ino, after.mtimeNs, recordAfter.ino, recordAfter.mtimeNs]).toEqual([before.ino, before.mtimeNs, recordBefore.ino, recordBefore.mtimeNs]);
});

it('updates test-owned unchanged managed content and its digest without touching neighboring files', async () => {
  const old = '---\nname: old-test-skill\n---\nTest-owned old release.\n';
  await oldManagedSkill(old);
  await writeFile(join(skillDir, 'user-notes.txt'), 'Keep this user note.\n');
  const bundle = await readFile(new URL('./dashboard-skill/SKILL.md', import.meta.url));
  expect(await installDashboardSkill(vault, app)).toBe('updated');
  expect(await readFile(skill)).toEqual(bundle);
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual({ digest: hash(bundle) });
  expect(await readFile(join(skillDir, 'user-notes.txt'), 'utf8')).toBe('Keep this user note.\n');
  expect(await installDashboardSkill(vault, app)).toBe('unchanged');
});

it('preserves a customized previously managed skill and the last managed digest', async () => {
  await oldManagedSkill('test-owned original');
  const before = await readFile(manifest);
  await writeFile(skill, 'user customization');
  expect(await installDashboardSkill(vault, app)).toBe('conflict');
  expect(await readFile(skill, 'utf8')).toBe('user customization');
  expect(await readFile(manifest)).toEqual(before);
});

it.each(['file', 'directory'] as const)('does not adopt an unowned skill %s', async kind => {
  await mkdir(skillDir, { recursive: true });
  if (kind === 'file') await writeFile(skill, 'unowned skill');
  await writeFile(join(skillDir, 'user-notes.txt'), 'unowned sibling');
  expect(await installDashboardSkill(vault, app)).toBe('conflict');
  if (kind === 'file') expect(await readFile(skill, 'utf8')).toBe('unowned skill');
  else await expect(lstat(skill)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(skillDir, 'user-notes.txt'), 'utf8')).toBe('unowned sibling');
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['.opencode', 'skills', 'skill directory'] as const)('rejects symlinked %s without writing outside the vault', async part => {
  const sentinel = join(outside, 'sentinel');
  await writeFile(sentinel, 'outside sentinel');
  let target: string;
  if (part === '.opencode') target = join(vault, '.opencode');
  else if (part === 'skills') { await mkdir(join(vault, '.opencode')); target = join(vault, '.opencode', 'skills'); }
  else { await mkdir(join(vault, '.opencode', 'skills'), { recursive: true }); target = skillDir; }
  await symlink(outside, target, 'dir');
  await expect(installDashboardSkill(vault, app)).rejects.toThrow();
  expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel');
  expect((await lstat(target)).isSymbolicLink()).toBe(true);
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['symlink', 'hardlink'] as const)('rejects a managed target replaced by a %s', async kind => {
  await oldManagedSkill('test-owned original');
  const originalManifest = await readFile(manifest);
  const external = join(outside, 'SKILL.md');
  await writeFile(external, 'test-owned original');
  await rm(skill);
  if (kind === 'symlink') await symlink(external, skill);
  else await link(external, skill);
  await expect(installDashboardSkill(vault, app)).rejects.toThrow();
  expect(await readFile(external, 'utf8')).toBe('test-owned original');
  expect(await readFile(manifest)).toEqual(originalManifest);
});

it.each(['symlink', 'hardlink'] as const)('rejects an ownership record replaced by a %s', async kind => {
  await oldManagedSkill('test-owned original');
  const original = await readFile(manifest);
  const external = join(outside, 'record.json');
  await writeFile(external, original);
  await rm(manifest);
  if (kind === 'symlink') await symlink(external, manifest);
  else await link(external, manifest);
  await expect(installDashboardSkill(vault, app)).rejects.toThrow();
  expect(await readFile(external)).toEqual(original);
  expect(await readFile(skill, 'utf8')).toBe('test-owned original');
});

it('does not adopt a completed file after its ownership record is lost', async () => {
  expect(await installDashboardSkill(vault, app)).toBe('installed');
  const before = await readFile(skill);
  await rm(manifest);
  expect(await installDashboardSkill(vault, app)).toBe('conflict');
  expect(await readFile(skill)).toEqual(before);
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves installed bytes if publication succeeded but the ownership record remained at the old digest', async () => {
  await oldManagedSkill('test-owned old release');
  const oldRecord = await readFile(manifest);
  const published = Buffer.from('test-owned newer published release');
  await writeFile(skill, published);
  expect(await installDashboardSkill(vault, app)).toBe('conflict');
  expect(await readFile(skill)).toEqual(published);
  expect(await readFile(manifest)).toEqual(oldRecord);
});

it('does not replace a missing managed file or a malformed ownership record', async () => {
  await oldManagedSkill('test-owned old release');
  await rm(skill);
  const before = await readFile(manifest);
  expect(await installDashboardSkill(vault, app)).toBe('conflict');
  await expect(lstat(skill)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(manifest)).toEqual(before);
  await writeFile(manifest, '{malformed');
  await expect(installDashboardSkill(vault, app)).rejects.toThrow();
  expect(await readFile(manifest, 'utf8')).toBe('{malformed');
  await expect(lstat(skill)).rejects.toMatchObject({ code: 'ENOENT' });
});
