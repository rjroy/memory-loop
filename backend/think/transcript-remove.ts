import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import type { StoredTranscript } from './state';
import { TranscriptError, TranscriptNamespace, transcriptFingerprint, transcriptIO, type TranscriptIO } from './transcript-file';

const files = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
function conflict(): never { throw new TranscriptError('conflict'); }

/** Read-only verification followed by unlink+directory sync. Never create directories,
 * finish an append, infer a path from current settings, or adopt an intent-only collision. */
export async function removeMappedTranscript(vault: string, record: StoredTranscript | null,
  chunk: (index: number) => Uint8Array | null, stopping: () => boolean, io: TranscriptIO = transcriptIO): Promise<void> {
  if (!record) return; // Quiesced registry has no creation intent or acquired transcript.
  if (record.namespace.length !== record.noteId.length || record.noteId.at(-1) !== `think-${record.conversationId}.md`) conflict();
  const namespace = new TranscriptNamespace(vault, record.noteId.slice(0, -1).join('/'), io);
  const check = async () => {
    if (stopping()) throw new TranscriptError('io_unavailable');
    await namespace.validate();
    if (JSON.stringify(namespace.identities()) !== JSON.stringify(record.namespace)) conflict();
  };
  try {
    await namespace.prepare(false);
    await check();
    const name = record.noteId[record.noteId.length - 1];
    const path = namespace.path(name);
    try { await io.lstat(path); } catch (error) {
      if (!absent(error)) throw error;
      await check(); await namespace.sync(false); return;
    }
    await namespace.resolve(name, 'file');
    // Verification only reads this handle; unlink durability requires a directory flush, not file sync.
    const file = await io.open(path, files);
    try {
      if (!record.file) conflict();
      const checkpoint = record.file;
      const baseline = await file.stat();
      const verify = async () => {
        await check();
        const stat = await file.stat(); const named = await io.lstat(await namespace.resolve(name, 'file'));
        if (!stat.isFile() || !named.isFile() || stat.nlink !== 1 || named.nlink !== 1 ||
            stat.dev !== checkpoint.dev || stat.ino !== checkpoint.ino || named.dev !== stat.dev || named.ino !== stat.ino ||
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
      const tail = baseline.size - checkpoint.offset;
      if (tail < 0 || tail > (pending?.state === 'ready' ? pending.length : 0)) conflict();
      if (!pending || pending.state !== 'ready') {
        if (transcriptFingerprint(baseline) !== checkpoint.fingerprint) conflict();
      }
      const prefix = createHash('sha256');
      for (let at = 0; at < checkpoint.offset; at += 65536) prefix.update(await read(at, Math.min(65536, checkpoint.offset - at)));
      if (prefix.digest('hex') !== checkpoint.sha256) conflict();
      if (pending?.state === 'ready') {
        let length = 0; const hash = createHash('sha256');
        for (let index = 0; index < pending.chunks; index++) {
          const bytes = chunk(index);
          if (!bytes || bytes.length > 65536) conflict();
          const size = Math.min(bytes.length, Math.max(0, tail - length));
          if (size && !Buffer.from(await read(checkpoint.offset + length, size)).equals(Buffer.from(bytes.subarray(0, size)))) conflict();
          length += bytes.length; hash.update(bytes);
        }
        if (length !== pending.length || hash.digest('hex') !== pending.sha256 || chunk(pending.chunks) !== null) conflict();
      }
      await verify();
      if (stopping()) throw new TranscriptError('io_unavailable');
      await io.unlink(path);
      await check(); await namespace.sync(false);
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof TranscriptError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    throw new TranscriptError(['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code)) ? 'conflict' : 'io_unavailable');
  } finally { await namespace.close(); }
}
