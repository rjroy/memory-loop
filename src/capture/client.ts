import { captureTextLimit } from '../../backend/capture-contract';
import type { CaptureRequest, CaptureResponse } from '../../backend/capture-contract';

export type CaptureResult =
  | { kind: 'saved' }
  | { kind: 'rejected'; reason: 'invalid' | 'too-large' | 'unavailable' | 'forbidden' }
  | { kind: 'uncertain' };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const savedResponse = (value: unknown): value is CaptureResponse =>
  object(value) && value.ok === true && Object.keys(value).length === 1;

/** Bound untrusted responses without displaying upstream messages or private details. */
async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    throw new Error('Invalid Capture response');
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        void reader.cancel().catch(() => {});
        throw new Error('Capture response exceeded limit');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

function resultFromResponse(status: number, value: unknown): CaptureResult {
  if (status === 200 && savedResponse(value)) return { kind: 'saved' };
  if (!object(value) || !object(value.error) || typeof value.error.message !== 'string') return { kind: 'uncertain' };
  const code = value.error.code;
  if (status === 503 && code === 'capture_uncertain') return { kind: 'uncertain' };
  if (status === 503 && code === 'capture_unavailable') return { kind: 'rejected', reason: 'unavailable' };
  if (status === 400 && code === 'invalid_request') return { kind: 'rejected', reason: 'invalid' };
  if (status === 403 && code === 'forbidden') return { kind: 'rejected', reason: 'forbidden' };
  if ((status === 404 && code === 'not_found') || (status === 405 && code === 'method_not_allowed')) {
    return { kind: 'rejected', reason: 'unavailable' };
  }
  // Unexpected HTTP status, malformed success and transport gaps cannot prove no write.
  return { kind: 'uncertain' };
}

/** One same-origin attempt. Timeout ends observation, not the daemon-owned write. */
export async function captureThought(text: string): Promise<CaptureResult> {
  if (!text.trim()) return { kind: 'rejected', reason: 'invalid' };
  if (new TextEncoder().encode(text).byteLength > captureTextLimit) return { kind: 'rejected', reason: 'too-large' };
  // Correlation only, not an auth/command identity; private-LAN HTTP may lack randomUUID.
  const attemptId = crypto.randomUUID?.() ?? `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  console.info('capture_request_attempt', { attemptId });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: CaptureResult;
  try {
    const request: CaptureRequest = { text };
    const operation = async (): Promise<CaptureResult> => {
      const response = await fetch('/api/capture', {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request), signal: controller.signal,
      });
      return resultFromResponse(response.status, await readResponse(response, controller.signal));
    };
    result = await Promise.race([operation(), new Promise<CaptureResult>(resolve => {
      // Longer than the BFF's upstream deadline, but never leave the action stuck forever.
      timer = setTimeout(() => { controller.abort(); resolve({ kind: 'uncertain' }); }, 12000);
    })]);
  } catch { result = { kind: 'uncertain' }; }
  finally { if (timer !== undefined) clearTimeout(timer); }
  console.info('capture_request_outcome', { attemptId, outcome: result.kind, ...(result.kind === 'rejected' ? { reason: result.reason } : {}) });
  return result;
}
