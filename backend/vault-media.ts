import type { FileHandle } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import type { VaultFileResponse } from './contract';

const textLimit = 2 * 1024 * 1024;
const inlineTypes: Record<string, 'image' | 'video'> = {
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'image/avif': 'image', 'image/heic': 'image', 'image/heif': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video', 'video/ogg': 'video',
};

export async function sniff(file: FileHandle, size: number) {
  const buffer = Buffer.alloc(Math.min(size, 8192));
  const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try { detected = await fileTypeFromBuffer(buffer.subarray(0, bytesRead)); } catch { /* Incomplete or unknown signatures are not inline media. */ }
  const contentType = detected?.mime;
  const kind = contentType ? inlineTypes[contentType] : undefined;
  return { contentType: kind && contentType ? contentType : 'application/octet-stream', kind };
}

export async function describeFile(file: FileHandle, name: string, size: number): Promise<VaultFileResponse> {
  const detected = await sniff(file, size);
  if (detected.kind) return { name, kind: detected.kind, contentType: detected.contentType };
  if (size > textLimit) return { name, kind: 'unsupported' };
  const bytes = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset !== size || offset > textLimit || bytes.subarray(0, offset).includes(0)) return { name, kind: 'unsupported' };
  try { return { name, kind: 'text', text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset)) }; }
  catch { return { name, kind: 'unsupported' }; }
}

export type ByteRange = { start: number; end: number } | 'invalid' | 'unsatisfiable';
export function byteRange(value: string, size: number): ByteRange {
  if (value.length > 256) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return 'invalid';
  const length = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (!suffix || !size) return 'unsatisfiable';
    return { start: Number(suffix >= length ? 0n : length - suffix), end: size - 1 };
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : length - 1n;
  if (start >= length || end < start) return 'unsatisfiable';
  return { start: Number(start), end: Number(end >= length ? length - 1n : end) };
}

function disposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Takes ownership of the opened regular descriptor, including error and cancellation paths. */
export async function contentResponse(file: FileHandle, name: string, size: number, method: string, range: string | null, download: boolean, signal: AbortSignal, afterSniff?: () => Promise<void>): Promise<Response> {
  let owned = true;
  const abort = () => { void close(); };
  const close = async () => { if (owned) { owned = false; signal.removeEventListener('abort', abort); await file.close().catch(() => {}); } };
  try {
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) throw new Error('Request aborted');
    const media = await sniff(file, size);
    await afterSniff?.();
    const headers = new Headers({
      'content-type': media.contentType, 'content-disposition': disposition(name, !!media.kind && !download),
      'content-security-policy': 'sandbox', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
    });
    const selected = method === 'HEAD' || range === null ? undefined : byteRange(range, size);
    if (selected === 'invalid') {
      await close();
      return Response.json({ error: { code: 'invalid_request', message: 'Invalid note identifier' } }, { status: 400, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' } });
    }
    if (selected === 'unsatisfiable') { headers.set('content-range', `bytes */${size}`); await close(); return new Response(null, { status: 416, headers }); }
    const start = selected?.start ?? 0;
    const end = selected?.end ?? size - 1;
    headers.set('content-length', String(Math.max(0, end - start + 1)));
    if (selected) headers.set('content-range', `bytes ${start}-${end}/${size}`);
    if (method === 'HEAD' || size === 0) { await close(); return new Response(null, { status: 200, headers }); }
    let position = start;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (position > end) { await close(); controller.close(); return; }
          const buffer = Buffer.alloc(Math.min(64 * 1024, end - position + 1));
          const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
          if (!bytesRead) { await close(); controller.close(); return; }
          position += bytesRead;
          controller.enqueue(buffer.subarray(0, bytesRead));
          if (position > end) { await close(); controller.close(); }
        } catch (error) { await close(); controller.error(error); }
      },
      async cancel() { await close(); },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: selected ? 206 : 200, headers });
  } catch (error) { await close(); throw error; }
}
