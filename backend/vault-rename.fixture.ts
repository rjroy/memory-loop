// Run with Bun on Linux/glibc: bun backend/vault-rename.fixture.ts
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { renameNoReplace } from './vault-rename';

const fixture = await mkdtemp('/tmp/opencode/memory-loop-rename-');
const handles: Awaited<ReturnType<typeof open>>[] = [];
try {
  await mkdir(`${fixture}/source`);
  await mkdir(`${fixture}/destination`);
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const source = await open(`${fixture}/source`, flags);
  const destination = await open(`${fixture}/destination`, flags);
  handles.push(source, destination);
  const move = (name: string) => renameNoReplace(source.fd, name, destination.fd, name);
  await writeFile(`${fixture}/source/note.md`, 'note');
  await move('note.md');
  assert.equal(await readFile(`${fixture}/destination/note.md`, 'utf8'), 'note');
  await writeFile(`${fixture}/source/note.md`, 'source');
  await assert.rejects(move('note.md'), { code: 'EEXIST' });
  assert.equal(await readFile(`${fixture}/source/note.md`, 'utf8'), 'source');
  assert.equal(await readFile(`${fixture}/destination/note.md`, 'utf8'), 'note');
  await mkdir(`${fixture}/source/folder`);
  await writeFile(`${fixture}/source/folder/.hidden`, 'hidden');
  await writeFile(`${fixture}/source/folder/other.txt`, 'other');
  await move('folder');
  assert.equal(await readFile(`${fixture}/destination/folder/.hidden`, 'utf8'), 'hidden');
  assert.equal(await readFile(`${fixture}/destination/folder/other.txt`, 'utf8'), 'other');
  await mkdir(`${fixture}/source/folder`);
  await assert.rejects(move('folder'), { code: 'EEXIST' });
  await symlink('missing', `${fixture}/destination/link.md`);
  await writeFile(`${fixture}/source/link.md`, 'link source');
  await assert.rejects(move('link.md'), { code: 'EEXIST' });
  assert.equal((await lstat(`${fixture}/destination/link.md`)).isSymbolicLink(), true);
  assert.equal(await readFile(`${fixture}/source/link.md`, 'utf8'), 'link source');
  try {
    const other = await open('/dev/shm', flags);
    handles.push(other);
    if ((await source.stat()).dev !== (await other.stat()).dev) {
      await assert.rejects(renameNoReplace(source.fd, 'note.md', other.fd, `memory-loop-never-created-${crypto.randomUUID()}`), { code: 'EXDEV' });
      assert.equal(await readFile(`${fixture}/source/note.md`, 'utf8'), 'source');
      console.log('cross-device refusal passed');
    } else console.log('cross-device check skipped: same device');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.log('cross-device check skipped: /dev/shm unavailable');
  }
  console.log('file, directory, collision, symlink and hidden-content checks passed');
} finally {
  for (const handle of handles.reverse()) await handle.close();
  await rm(fixture, { recursive: true, force: true });
}
