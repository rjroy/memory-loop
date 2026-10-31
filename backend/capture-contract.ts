/** Capture accepts at most 1 MiB of UTF-8 text. JSON escaping can use six bytes per input byte. */
export const captureTextLimit = 1024 * 1024;
export const captureBodyLimit = 6 * captureTextLimit + 4096;
export interface CaptureRequest { text: string }
export interface CaptureResponse { ok: true }
export const captureErrors = {
  invalid_request: { status: 400, message: 'Invalid Capture request (maximum 1 MiB of UTF-8 text)' },
  capture_unavailable: { status: 503, message: 'Capture is unavailable' },
  capture_uncertain: { status: 503, message: 'Capture save is unconfirmed' },
} as const;

export function isCaptureResponse(value: unknown): value is CaptureResponse {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    'ok' in value && value.ok === true && Object.keys(value).length === 1;
}

export function parseCaptureRequest(value: unknown): CaptureRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
      !('text' in value) || typeof value.text !== 'string' || !value.text.trim() ||
      new TextEncoder().encode(value.text).byteLength > captureTextLimit) return undefined;
  return { text: value.text };
}
