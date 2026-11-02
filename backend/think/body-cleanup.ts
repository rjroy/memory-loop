import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { CacheNamespace } from './state';
import { TranscriptError } from './transcript-file';

const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
function conflict(): never { throw new TranscriptError('conflict'); }

/** Only a persisted, acquired conversation namespace authorizes its derivative-file cleanup.
 * Unknown old epoch directories are never scanned or adopted. */
export async function removeCacheNamespace(record: CacheNamespace, vault: string): Promise<void> {
  try { await removeNamespace(record, vault); }
  catch (error) {
    if (error instanceof TranscriptError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    throw new TranscriptError(['ENOENT', 'ENOTDIR', 'ELOOP', 'ENOTEMPTY'].includes(String(code)) ? 'conflict' : 'io_unavailable');
  }
}
async function removeNamespace(record: CacheNamespace, vault: string): Promise<void> {
  if (!uuid.test(record.conversationId) || !uuid.test(record.epoch)) conflict();
  const fromVault = relative(await realpath(vault), record.path);
  if (!isAbsolute(record.path) || !fromVault || fromVault !== '..' && !fromVault.startsWith(`..${sep}`) && !isAbsolute(fromVault) || await realpath(record.path) !== record.path) conflict();
  const root = await open(record.path, dirFlags);
  try {
    const rootStat = await root.stat(); const namedRoot = await lstat(record.path);
    if (!rootStat.isDirectory() || rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o7777) !== 0o700 ||
        rootStat.dev !== record.root.dev || rootStat.ino !== record.root.ino || namedRoot.dev !== rootStat.dev || namedRoot.ino !== rootStat.ino) conflict();
    const path = `/proc/self/fd/${root.fd}/${record.conversationId}`;
    let folder;
    try { folder = await open(path, dirFlags); } catch (error) {
      if (!absent(error)) throw error;
      await root.sync(); return; // rmdir succeeded before its SQLite acknowledgement.
    }
    try {
      if (!record.directory) conflict(); // An unacquired existing directory is not ours to adopt.
      const check = async () => {
        const held = await folder.stat(); const named = await lstat(path); const namedRoot = await lstat(record.path);
        if (!held.isDirectory() || !named.isDirectory() || held.uid !== process.getuid?.() || (held.mode & 0o7777) !== 0o700 ||
            held.dev !== record.directory?.dev || held.ino !== record.directory.ino || named.dev !== held.dev || named.ino !== held.ino ||
            !namedRoot.isDirectory() || namedRoot.dev !== rootStat.dev || namedRoot.ino !== rootStat.ino) conflict();
      };
      await check();
      // Streaming enumeration: no whole epoch, vault, recursive traversal or arbitrary names.
      const entries = await opendir(`/proc/self/fd/${folder.fd}`, { bufferSize: 32 });
      for await (const entry of entries) {
        const name = entry.name;
        if (!uuid.test(name)) conflict();
        await check();
        const filePath = `/proc/self/fd/${folder.fd}/${name}`;
        const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const held = await file.stat(); const named = await lstat(filePath);
          if (!held.isFile() || !named.isFile() || held.uid !== process.getuid?.() || held.nlink !== 1 || (held.mode & 0o7777) !== 0o600 ||
              named.dev !== held.dev || named.ino !== held.ino || named.nlink !== 1) conflict();
          await check(); await unlink(filePath);
        } finally { await file.close(); }
      }
      await folder.sync();
      await check();
      await rmdir(path); await root.sync();
    } finally { await folder.close(); }
  } finally { await root.close(); }
}
