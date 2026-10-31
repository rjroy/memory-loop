/** Capture accepts at most 1 MiB of UTF-8 text. JSON escaping can use six bytes per input byte. */
export const captureTextLimit = 1024 * 1024;
export const captureBodyLimit = 6 * captureTextLimit + 4096;
export interface CaptureRequest { text: string }
export interface CaptureResponse { ok: true }
export type CaptureErrorCode = 'invalid_request' | 'capture_unavailable' | 'capture_uncertain';
export interface CaptureErrorResponse { error: { code: CaptureErrorCode; message: string } }

export function parseCaptureRequest(value: unknown): CaptureRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
      !('text' in value) || typeof value.text !== 'string' || !value.text.trim() ||
      new TextEncoder().encode(value.text).byteLength > captureTextLimit) return undefined;
  return { text: value.text };
}
