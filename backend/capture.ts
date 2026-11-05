import { lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { openSafeRoot, type SafeRoot } from './safe-fs';

export class CaptureError extends Error {
  constructor(readonly code: 'capture_unavailable' | 'capture_uncertain') {
    super(code);
  }
}

export interface CaptureWriter {
  capture(text: string): Promise<void>;
  close(): Promise<void>;
}

/** Narrow seams allow controlled clock, short-write and flush-failure tests. */
export interface CaptureWriterOptions {
  now?: () => Date;
  write?: (file: FileHandle, bytes: Buffer, offset: number) => Promise<number>;
  flush?: (file: FileHandle) => Promise<void>;
}

const pad = (value: number) => String(value).padStart(2, '0');

export async function openCaptureWriter(root: string, options: CaptureWriterOptions = {}): Promise<CaptureWriter> {
  let safe: SafeRoot;
  try { safe = await openSafeRoot(root); }
  catch { throw new CaptureError('capture_unavailable'); }
  const now = options.now ?? (() => new Date());
  const write = options.write ?? (async (file, bytes, offset) => (await file.write(bytes, offset, bytes.length - offset, null)).bytesWritten);
  const flush = options.flush ?? (async file => file.sync());
  let queue: Promise<void> = Promise.resolve();
  let closed = false;

  async function append(text: string): Promise<void> {
    let file: FileHandle | undefined;
    let writeAttempted = false;
    try {
      const date = now();
      if (!Number.isFinite(date.getTime())) throw new Error('invalid clock');
      const name = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
      try { await safe.createDirectory(['00_Inbox']); } catch (error: unknown) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      const id = ['00_Inbox', name];
      let created: { dev: bigint; ino: bigint } | undefined;
      let newFile: FileHandle | undefined;
      try {
        newFile = await safe.createFile(id);
      } catch (error: unknown) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      if (newFile) {
        try { created = await newFile.stat({ bigint: true }); }
        finally { await newFile.close(); }
      }
      file = await safe.openFile(id, 'append');
      const info = await file.stat({ bigint: true });
      if (!info.isFile() || info.nlink !== 1n || (created && (info.dev !== created.dev || info.ino !== created.ino))) throw new Error('unsafe target');
      let separator = '';
      if (info.size > 0n) {
        const position = Number(info.size - 1n);
        if (!Number.isSafeInteger(position)) throw new Error('unsafe target size');
        const last = Buffer.alloc(1);
        if ((await file.read(last, 0, 1, position)).bytesRead !== 1) throw new Error('cannot read target');
        if (last[0] !== 10) separator = '\n';
      }
      const normalized = text.replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ');
      const bytes = Buffer.from(`${separator}- [${pad(date.getHours())}:${pad(date.getMinutes())}] ${normalized}\n`, 'utf8');
      const current = await lstat(await safe.resolve(id, 'file'), { bigint: true });
      const opened = await file.stat({ bigint: true });
      if (!current.isFile() || current.nlink !== 1n || current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('unsafe target');
      let offset = 0;
      while (offset < bytes.length) {
        // A failed write call can have progressed even if it did not report a count.
        writeAttempted = true;
        const count = await write(file, bytes, offset);
        if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('invalid write progress');
        offset += count;
      }
      await flush(file);
      await file.close();
      file = undefined;
    } catch {
      throw new CaptureError(writeAttempted ? 'capture_uncertain' : 'capture_unavailable');
    } finally {
      await file?.close().catch(() => {});
    }
  }
  return {
    async capture(text) {
      if (closed) throw new CaptureError('capture_unavailable');
      const operation = queue.then(() => append(text));
      queue = operation.catch(() => {});
      return operation;
    },
    async close() { closed = true; await queue; },
  };
}
