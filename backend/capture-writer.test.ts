import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCaptureWriter, type CaptureWriter } from './capture';

let root: string;
let writer: CaptureWriter | undefined;
const now = () => new Date(2024, 1, 3, 9, 7);
const note = () => join(root, '00_Inbox', '2024-02-03.md');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'capture-writer-test-'));
  await mkdir(join(root, '00_Inbox'));
  await writeFile(note(), 'original bytes');
});
afterEach(async () => {
  try { await writer?.close(); }
  finally { writer = undefined; await rm(root, { recursive: true, force: true }); }
});

describe('Capture writer progress and failure ownership', () => {
  it('completes short writes before flushing and confirming success', async () => {
    const offsets: number[] = [];
    const flush = vi.fn(async (file: FileHandle) => { await file.sync(); });
    writer = await openCaptureWriter(root, { now, flush, write: async (file, bytes, offset) => {
      offsets.push(offset);
      return (await file.write(bytes, offset, Math.min(3, bytes.length - offset), null)).bytesWritten;
    } });
    await writer.capture('first\nsecond');
    expect(offsets.length).toBeGreaterThan(1);
    expect(offsets[0]).toBe(0);
    expect(offsets.every((offset, index) => index === 0 || offset === offsets[index - 1] + 3)).toBe(true);
    expect(flush).toHaveBeenCalledOnce();
    expect(await readFile(note(), 'utf8')).toBe('original bytes\n- [09:07] first\n  second\n');
  });

  it('reports uncertainty after partial progress and continues the queue without rollback', async () => {
    let calls = 0;
    writer = await openCaptureWriter(root, { now, write: async (file, bytes, offset) => {
      calls++;
      if (calls === 1) return (await file.write(bytes, offset, 7, null)).bytesWritten;
      if (calls === 2) throw new Error('fixture write failure');
      return (await file.write(bytes, offset, bytes.length - offset, null)).bytesWritten;
    } });
    const first = writer.capture('interrupted');
    const firstResult = expect(first).rejects.toMatchObject({ code: 'capture_uncertain' });
    const second = writer.capture('next');
    await firstResult;
    await expect(second).resolves.toBeUndefined();
    expect(await readFile(note(), 'utf8')).toBe('original bytes\n- [09:\n- [09:07] next\n');
  });

  it.each([0, -1, NaN, Infinity, 1.5, 999999])('rejects invalid write progress %s as uncertain without overwriting prior bytes', async progress => {
    writer = await openCaptureWriter(root, { now, write: async () => progress });
    await expect(writer.capture('entry')).rejects.toMatchObject({ code: 'capture_uncertain' });
    expect(await readFile(note(), 'utf8')).toBe('original bytes');
  });

  it('treats an unreported failed first write as uncertain', async () => {
    writer = await openCaptureWriter(root, { now, write: async (file, bytes, offset) => {
      await file.write(bytes, offset, 4, null);
      throw new Error('failure after unreported progress');
    } });
    await expect(writer.capture('entry')).rejects.toMatchObject({ code: 'capture_uncertain' });
    expect(await readFile(note(), 'utf8')).toBe('original bytes\n- [');
  });

  it('reports flush failure as uncertain and preserves the complete append', async () => {
    writer = await openCaptureWriter(root, { now, flush: async () => { throw new Error('fixture flush failure'); } });
    await expect(writer.capture('entry')).rejects.toMatchObject({ code: 'capture_uncertain' });
    expect(await readFile(note(), 'utf8')).toBe('original bytes\n- [09:07] entry\n');
  });

  it('reports a pre-write failure as definitely unavailable', async () => {
    const write = vi.fn(async () => 0);
    writer = await openCaptureWriter(root, { now: () => new Date(NaN), write });
    await expect(writer.capture('entry')).rejects.toMatchObject({ code: 'capture_unavailable' });
    expect(write).not.toHaveBeenCalled();
    expect(await readFile(note(), 'utf8')).toBe('original bytes');
  });
});
