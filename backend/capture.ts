import { constants } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

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

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const descriptorPath = (file: FileHandle, name?: string) => `/proc/self/fd/${file.fd}${name === undefined ? '' : `/${name}`}`;
const pad = (value: number) => String(value).padStart(2, '0');

export async function openCaptureWriter(root: string, options: CaptureWriterOptions = {}): Promise<CaptureWriter> {
  if (process.platform !== 'linux' || !constants.O_DIRECTORY || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) throw new CaptureError('capture_unavailable');
  let pinned: FileHandle | undefined;
  try {
    pinned = await open(root, directoryFlags);
    const actual = await pinned.stat();
    const viaProc = await stat(descriptorPath(pinned));
    if (!viaProc.isDirectory() || actual.dev !== viaProc.dev || actual.ino !== viaProc.ino) throw new Error('descriptor unavailable');
  } catch {
    await pinned?.close();
    throw new CaptureError('capture_unavailable');
  }
  const rootHandle = pinned;
  const now = options.now ?? (() => new Date());
  const write = options.write ?? (async (file, bytes, offset) => (await file.write(bytes, offset, bytes.length - offset, null)).bytesWritten);
  const flush = options.flush ?? (async file => file.sync());
  let queue: Promise<void> = Promise.resolve();
  let closed = false;

  async function append(text: string): Promise<void> {
    let inbox: FileHandle | undefined;
    let file: FileHandle | undefined;
    let writeAttempted = false;
    try {
      const date = now();
      if (!Number.isFinite(date.getTime())) throw new Error('invalid clock');
      const name = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
      const inboxPath = descriptorPath(rootHandle, '00_Inbox');
      try { await mkdir(inboxPath); } catch (error: unknown) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      inbox = await open(inboxPath, directoryFlags);
      file = await open(descriptorPath(inbox, name), fileFlags, 0o600);
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error('unsafe target');
      let separator = '';
      if (info.size > 0) {
        const last = Buffer.alloc(1);
        if ((await file.read(last, 0, 1, info.size - 1)).bytesRead !== 1) throw new Error('cannot read target');
        if (last[0] !== 10) separator = '\n';
      }
      const normalized = text.replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ');
      const bytes = Buffer.from(`${separator}- [${pad(date.getHours())}:${pad(date.getMinutes())}] ${normalized}\n`, 'utf8');
      let offset = 0;
      while (offset < bytes.length) {
        // A failed write call can have progressed even if it did not report a count.
        writeAttempted = true;
        const count = await write(file, bytes, offset);
        if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('invalid write progress');
        offset += count;
      }
      await flush(file);
    } catch {
      throw new CaptureError(writeAttempted ? 'capture_uncertain' : 'capture_unavailable');
    } finally {
      // A close error after writing cannot safely turn a potentially saved entry into a rejection.
      try { await file?.close(); } finally { await inbox?.close(); }
    }
  }
  return {
    async capture(text) {
      if (closed) throw new CaptureError('capture_unavailable');
      const operation = queue.then(() => append(text));
      queue = operation.catch(() => {});
      return operation;
    },
    async close() { closed = true; await queue; await rootHandle.close(); },
  };
}
