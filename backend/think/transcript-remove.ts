import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import type { StoredTranscript } from './state';
import { TranscriptError, transcriptFingerprint, transcriptIO, type TranscriptHandle, type TranscriptIO } from './transcript-file';

const directories = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const files = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
function conflict(): never { throw new TranscriptError('conflict'); }

/** Read-only verification followed by unlink+directory sync. Never create directories,
 * finish an append, infer a path from current settings, or adopt an intent-only collision. */
export async function removeMappedTranscript(vault: string, record: StoredTranscript | null,
  chunk: (index: number) => Uint8Array | null, stopping: () => boolean, io: TranscriptIO = transcriptIO): Promise<void> {
  if (!record) return; // Quiesced registry has no creation intent or acquired transcript.
  const held: TranscriptHandle[] = [];
  const paths: string[] = [];
  const check = async () => {
    if (stopping()) throw new TranscriptError('io_unavailable');
    for (let index = 0; index < held.length; index++) {
      const stat = await held[index].stat(); const named = await io.lstat(paths[index]); const expected = record.namespace[index];
      if (!expected || !stat.isDirectory() || !named.isDirectory() || stat.dev !== expected.dev || stat.ino !== expected.ino || named.dev !== stat.dev || named.ino !== stat.ino) conflict();
    }
  };
  try {
    if (await io.realpath(vault) !== vault || record.namespace.length !== record.noteId.length) conflict();
    for (let index = 0; index < record.namespace.length; index++) {
      const path = index === 0 ? vault : `/proc/self/fd/${held[index - 1].fd}/${record.noteId[index - 1]}`;
      paths.push(path); held.push(await io.open(path, directories)); await check();
    }
    const parent = held[held.length - 1];
    const path = `/proc/self/fd/${parent.fd}/${record.noteId[record.noteId.length - 1]}`;
    let file: TranscriptHandle;
    try { file = await io.open(path, files); } catch (error) {
      if (!absent(error)) throw error;
      await check(); await parent.sync(); return;
    }
    try {
      if (!record.file) conflict();
      const baseline = await file.stat();
      const verify = async () => {
        await check();
        const stat = await file.stat(); const named = await io.lstat(path);
        if (!stat.isFile() || !named.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || named.nlink !== 1 || (stat.mode & 0o7777) !== 0o600 ||
            stat.dev !== record.file?.dev || stat.ino !== record.file.ino || named.dev !== stat.dev || named.ino !== stat.ino ||
            transcriptFingerprint(stat) !== transcriptFingerprint(baseline) || transcriptFingerprint(named) !== transcriptFingerprint(stat)) conflict();
      };
      await verify();
      const read = async (offset: number, length: number) => {
        const bytes = new Uint8Array(length);
        for (let at = 0; at < length;) {
          if (stopping()) throw new TranscriptError('io_unavailable');
          const result = await file.read(bytes, at, length - at, offset + at);
          if (!result.bytesRead || result.bytesRead > length - at) conflict();
          at += result.bytesRead;
        }
        return bytes;
      };
      const pending = record.pending;
      const tail = baseline.size - record.file.offset;
      if (tail < 0 || tail > (pending?.state === 'ready' ? pending.length : 0)) conflict();
      if (!pending || pending.state !== 'ready') {
        if (transcriptFingerprint(baseline) !== record.file.fingerprint) conflict();
      }
      const prefix = createHash('sha256');
      for (let at = 0; at < record.file.offset; at += 65536) prefix.update(await read(at, Math.min(65536, record.file.offset - at)));
      if (prefix.digest('hex') !== record.file.sha256) conflict();
      if (pending?.state === 'ready') {
        let length = 0; const hash = createHash('sha256');
        for (let index = 0; index < pending.chunks; index++) {
          const bytes = chunk(index);
          if (!bytes || bytes.length > 65536) conflict();
          const size = Math.min(bytes.length, Math.max(0, tail - length));
          if (size && !Buffer.from(await read(record.file.offset + length, size)).equals(Buffer.from(bytes.subarray(0, size)))) conflict();
          length += bytes.length; hash.update(bytes);
        }
        if (length !== pending.length || hash.digest('hex') !== pending.sha256 || chunk(pending.chunks) !== null) conflict();
      }
      await verify();
      if (stopping()) throw new TranscriptError('io_unavailable');
      await io.unlink(path);
      await check(); await parent.sync();
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof TranscriptError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    throw new TranscriptError(['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code)) ? 'conflict' : 'io_unavailable');
  } finally { await Promise.allSettled(held.reverse().map(handle => handle.close())); }
}
