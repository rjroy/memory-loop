import type { BigIntStats } from 'node:fs';
import { lstat, opendir, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize } from 'node:path';
import { openSafeRoot, SafeEntryError, SafeRootChangedError, sameFileIdentity } from '../safe-fs';
import type { CacheNamespace } from './state';
import { TranscriptError } from './transcript-file';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
function conflict(): never { throw new TranscriptError('conflict'); }

/** The existing directory and each physical ancestor must be outside the canonical vault.
 * Filesystem identity handles both case-sensitive Windows siblings and case aliases. */
export async function checkCacheOutsideVault(directory: string, vault: string): Promise<void> {
  if (!isAbsolute(vault) || vault.includes('\0')) conflict();
  const safe = await openSafeRoot(normalize(vault));
  const identity = await lstat(await safe.resolve([], 'directory'), { bigint: true });
  for (let ancestor = directory;;) {
    const entry = await lstat(ancestor, { bigint: true });
    if (!entry.isDirectory() || sameFileIdentity(entry, identity)) conflict();
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  await safe.resolve([], 'directory');
}

/** Only a persisted, acquired conversation namespace authorizes its derivative-file cleanup.
 * Unknown old epoch directories are never scanned or adopted. */
export async function removeCacheNamespace(record: CacheNamespace, vault: string): Promise<void> {
  try { await removeNamespace(record, vault); }
  catch (error) {
    if (error instanceof TranscriptError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    throw new TranscriptError(error instanceof SafeEntryError || error instanceof SafeRootChangedError ||
      ['ENOENT', 'ENOTDIR', 'ELOOP', 'ENOTEMPTY'].includes(String(code)) ? 'conflict' : 'io_unavailable');
  }
}
async function removeNamespace(record: CacheNamespace, vault: string): Promise<void> {
  if (!uuid.test(record.conversationId) || !uuid.test(record.epoch) || !isAbsolute(record.path) || record.path.includes('\0')) conflict();
  const nativePath = normalize(record.path);
  const parent = await openSafeRoot(dirname(nativePath));
  const rootName = basename(nativePath);
  const rootPath = await parent.resolve([rootName], 'directory');
  // The generated root is NOT a trusted configured link. Check it before realpath
  // can hide a replacement symlink/junction, even one pointing at the original inode.
  const initial = await lstat(rootPath);
  if (!initial.isDirectory() || initial.dev !== record.root.dev || initial.ino !== record.root.ino) conflict();
  await checkCacheOutsideVault(rootPath, vault);
  const root = await openSafeRoot(rootPath);
  const checkRoot = async () => {
    const named = await lstat(await parent.resolve([rootName], 'directory'));
    if (!named.isDirectory() || named.dev !== record.root.dev || named.ino !== record.root.ino) conflict();
    await root.resolve([], 'directory');
  };
  await checkRoot();
  let path: string;
  try { path = await root.resolve([record.conversationId], 'directory'); }
  catch (error) {
    if (!absent(error)) throw error;
    await checkRoot(); await root.syncDirectory([]); return; // rmdir preceded its SQLite acknowledgement.
  }
  if (!record.directory) conflict(); // An unacquired existing directory is not ours to adopt.
  const identity = record.directory;
  const check = async () => {
    await checkRoot();
    const named = await lstat(await root.resolve([record.conversationId], 'directory'));
    if (!named.isDirectory() || named.dev !== identity.dev || named.ino !== identity.ino) conflict();
  };
  await check();
  // Streaming enumeration closes its Dir before rmdir, including on iteration failures.
  const entries = await opendir(path, { bufferSize: 32 });
  for await (const entry of entries) {
    const name = entry.name;
    if (!uuid.test(name)) conflict();
    await check();
    const components = [record.conversationId, name];
    const file = await root.openFile(components, 'read');
    let held: BigIntStats;
    try {
      held = await file.stat({ bigint: true });
      const named = await lstat(await root.resolve(components, 'file'), { bigint: true });
      if (!held.isFile() || held.nlink !== 1n || !named.isFile() || named.nlink !== 1n || !sameFileIdentity(named, held)) conflict();
    } finally { await file.close(); }
    await check();
    const filePath = await root.resolve(components, 'file');
    const named = await lstat(filePath, { bigint: true });
    if (!named.isFile() || named.nlink !== 1n || !sameFileIdentity(named, held)) conflict();
    await unlink(filePath);
  }
  await check(); await root.syncDirectory([record.conversationId]);
  await check(); await rmdir(path);
  await checkRoot(); await root.syncDirectory([]);
}
