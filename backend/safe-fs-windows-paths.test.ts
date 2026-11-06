import { afterEach, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSafeRoot } from './safe-fs';

// Exercise SafeRoot against real win32 case-folding in relative(), translating only
// result separators for the host. All filesystem calls still use real Linux paths.
// This is comparison evidence, not evidence of native Windows filesystem behavior.
vi.mock('node:path', async importOriginal => {
  const path = await importOriginal<typeof import('node:path')>();
  return {
    ...path,
    relative: (from: string, to: string) => path.win32.relative(from, to).replaceAll('\\', '/'),
  };
});

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

it.skipIf(process.platform !== 'linux')('moves distinct case-sensitive siblings despite win32 relative case folding', async context => {
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-win-relative-'));
  fixtures.push(root);
  await mkdir(join(root, 'source'));
  try { await mkdir(join(root, 'SOURCE')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return context.skip();
    throw error;
  }
  await writeFile(join(root, 'source', 'file.txt'), 'original');
  await writeFile(join(root, 'SOURCE', 'keep.txt'), 'destination');
  const safe = await openSafeRoot(root);
  await safe.move(['source'], ['SOURCE', 'moved'], 'directory');
  expect(await readFile(join(root, 'SOURCE', 'moved', 'file.txt'), 'utf8')).toBe('original');
  expect(await readFile(join(root, 'SOURCE', 'keep.txt'), 'utf8')).toBe('destination');
  await expect(lstat(join(root, 'source'))).rejects.toThrow();
});
