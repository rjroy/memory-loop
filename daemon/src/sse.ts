/**
 * SSE Utilities
 *
 * Helper functions for Server-Sent Events streaming.
 */

/**
 * Encodes an object as an SSE message.
 * Format: "data: {json}\n\n"
 *
 * Accepts any object rather than a specific event type so it can
 * encode both SessionEvent payloads and snapshot payloads without
 * maintaining a union of every possible shape.
 */
export function encodeSSE(event: object): Uint8Array {
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
