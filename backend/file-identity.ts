import type { BigIntStats } from 'node:fs';

/**
 * An exact filesystem identity. Values come from `stat({ bigint: true })` and are kept as
 * canonical unsigned decimal strings: lossless for 64-bit NTFS file IDs above
 * Number.MAX_SAFE_INTEGER, comparable with `===`, and JSON/SQLite-TEXT safe.
 */
export interface FileIdentity { readonly dev: string; readonly ino: string }

const maxId = (1n << 64n) - 1n;
const canonical = /^(?:0|[1-9][0-9]{0,19})$/;

/** The exact decimal form of a stat identity value, or undefined if it is not an unsigned 64-bit integer. */
export function fileIdValue(value: bigint): string | undefined {
  return typeof value === 'bigint' && value >= 0n && value <= maxId ? value.toString() : undefined;
}

/**
 * Parses a persisted identity value: a canonical decimal string, or the legacy JSON/SQLite
 * number form, which was only ever written for nonnegative safe integers.
 */
export function parseFileIdValue(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  if (typeof value !== 'string' || !canonical.test(value) || BigInt(value) > maxId) return undefined;
  return value;
}

export function statIdentity(stat: BigIntStats): FileIdentity | undefined {
  const dev = fileIdValue(stat.dev); const ino = fileIdValue(stat.ino);
  return dev === undefined || ino === undefined ? undefined : { dev, ino };
}

/** Exact persisted identity: an object with only `dev` and `ino` in either accepted form. */
export function parseFileIdentity(value: unknown): FileIdentity | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return undefined;
  const dev = parseFileIdValue(record.dev); const ino = parseFileIdValue(record.ino);
  return dev === undefined || ino === undefined ? undefined : { dev, ino };
}

export function sameFileId(a: BigIntStats | FileIdentity, b: BigIntStats | FileIdentity): boolean {
  return String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
}

/** Exact, JSON-encoded file state for equality checks; ctime is omitted where it is not stable. */
export function exactFingerprint(s: BigIntStats, ctime: boolean): string {
  return JSON.stringify((ctime ? [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink, s.uid, s.mode]
    : [s.dev, s.ino, s.size, s.mtimeNs, s.nlink, s.uid, s.mode]).map(String));
}

/** Legacy fingerprints stored times as double milliseconds, which carry well under 1 microsecond of error. */
const closeTime = (ms: number, ns: bigint) => Math.abs(ms - Number(ns) / 1e6) <= 0.001;

/**
 * Whether `s` matches a persisted fingerprint: the exact form, or the legacy form
 * `[dev, ino, size, mtimeMs, ctimeMs, nlink, uid, mode]` of JSON numbers that predates exact
 * identities. Legacy integers must match exactly and times within that format's own precision.
 */
export function fingerprintMatches(s: BigIntStats, persisted: string, ctime: boolean): boolean {
  if (persisted === exactFingerprint(s, ctime)) return true;
  let legacy: unknown;
  try { legacy = JSON.parse(persisted); } catch { return false; }
  if (!Array.isArray(legacy) || legacy.length !== 8 || !legacy.every(value => typeof value === 'number' && Number.isFinite(value))) return false;
  const [dev, ino, size, mtimeMs, ctimeMs, nlink, uid, mode] = legacy as number[];
  const exact: Array<[number, bigint]> = [[dev, s.dev], [ino, s.ino], [size, s.size], [nlink, s.nlink], [uid, s.uid], [mode, s.mode]];
  return exact.every(([old, current]) => Number.isSafeInteger(old) && BigInt(old) === current) &&
    closeTime(mtimeMs, s.mtimeNs) && (!ctime || closeTime(ctimeMs, s.ctimeNs));
}
