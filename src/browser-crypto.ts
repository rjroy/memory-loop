import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { v4 as uuidv4 } from 'uuid';

/** Web Crypto's random bytes remain available on ordinary HTTP origins. */
export function secureUuid(): string {
  return uuidv4({ rng: () => crypto.getRandomValues(new Uint8Array(16)) });
}

/** Hash the exact received bytes, independent of secure-context-only SubtleCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(sha256(bytes));
}
