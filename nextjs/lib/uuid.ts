/**
 * Browser-safe RFC 4122 v4 UUID generation.
 *
 * `crypto.randomUUID()` is only defined in a *secure context* (HTTPS, or
 * http://localhost). Memory Loop is frequently served over plain HTTP on a LAN
 * IP, where `crypto.randomUUID` is `undefined` even though `crypto` and
 * `crypto.getRandomValues` are present. Calling it there throws
 * "crypto.randomUUID is not a function".
 *
 * This uses `crypto.randomUUID()` when available and otherwise builds a v4 UUID
 * from `crypto.getRandomValues()`, which is available in non-secure contexts.
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback: derive a v4 UUID from 16 random bytes.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set the version (4) and variant (10xx) bits per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
