/**
 * SSE Utilities
 *
 * Helper functions for Server-Sent Events streaming.
 */

import type { SessionEvent } from "./controller";

/**
 * Encodes a SessionEvent as an SSE message.
 * Format: "data: {json}\n\n"
 */
export function encodeSSE(event: SessionEvent): Uint8Array {
  const encoder = new TextEncoder();
  const data = `data: ${JSON.stringify(event)}\n\n`;
  return encoder.encode(data);
}

/**
 * Encodes an SSE comment (for keep-alive).
 * Format: ": comment\n\n"
 */
export function encodeSSEComment(comment: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`: ${comment}\n\n`);
}

/**
 * Standard SSE response headers.
 */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // Disable nginx buffering
};

/**
 * Creates an SSE response from a ReadableStream.
 */
export function createSSEResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: SSE_HEADERS,
  });
}
