import { lstat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, normalize } from 'node:path';
import { openSafeRoot, type SafeRoot } from './safe-fs';

export type TransportConfig = {
  daemonOrigin: string;
};
export interface LoadedTransport { config: TransportConfig; serviceToken: string }

type ErrorCode = 'transport_invalid' | 'transport_unavailable' | 'transport_exists';
class TransportError extends Error {
  constructor(readonly code: ErrorCode) { super('Transport configuration is unavailable or invalid'); this.name = 'TransportError'; }
}
function invalid(): never { throw new TransportError('transport_invalid'); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function origin(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.origin !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return invalid();
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return invalid();
  return value;
}

export function parseTransport(value: unknown): TransportConfig {
  if (!record(value)) return invalid();
  return { daemonOrigin: origin(value.daemonOrigin) };
}

async function readPrivate(root: SafeRoot, metadata: string, name: string): Promise<string> {
  const file = await root.openFile([metadata, name], 'read');
  try { return await file.readFile('utf8'); } finally { await file.close(); }
}
function normalizeError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return new TransportError(code === 'EEXIST' ? 'transport_exists' : 'transport_unavailable');
}

export async function loadTransport(transportFile: string): Promise<LoadedTransport> {
  try {
    if (!isAbsolute(transportFile)) invalid();
    const file = normalize(transportFile);
    if (basename(file) !== 'transport.json') invalid();
    const directory = dirname(file);
    const metadata = basename(directory);
    if (!metadata || dirname(directory) === directory) invalid();
    const root = await openSafeRoot(dirname(directory));
    await root.resolve([metadata], 'directory');
    let data: unknown;
    try { data = JSON.parse(await readPrivate(root, metadata, 'transport.json')); } catch (error) {
      if (error instanceof SyntaxError) invalid();
      throw error;
    }
    const config = parseTransport(data);
    const serviceToken = await readPrivate(root, metadata, 'service.token');
    if (!/^[a-f0-9]{64}$/.test(serviceToken)) invalid();
    return { config, serviceToken };
  } catch (error: unknown) { throw normalizeError(error); }
}

export async function setupTransport(projectRoot: string): Promise<void> {
  console.info('transport_setup_attempt');
  let root: SafeRoot | undefined;
  const created: Array<{ name: string; handle: FileHandle; identity?: { dev: bigint; ino: bigint }; closed: boolean }> = [];
  try {
    if (!isAbsolute(projectRoot)) invalid();
    root = await openSafeRoot(normalize(projectRoot));
    try { await root.createDirectory(['.memory-loop']); } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    await root.resolve(['.memory-loop'], 'directory');
    const config: TransportConfig = { daemonOrigin: 'http://127.0.0.1:3001' };
    for (const [name, content] of [['service.token', randomBytes(32).toString('hex')], ['transport.json', `${JSON.stringify(config, null, 2)}\n`]]) {
      const handle = await root.createFile(['.memory-loop', name]);
      const item: typeof created[number] = { name, handle, closed: false };
      created.push(item);
      item.identity = await handle.stat({ bigint: true });
      await handle.writeFile(content, 'utf8');
    }
    for (const item of created) { await item.handle.close(); item.closed = true; }
    console.info('transport_setup_outcome', { status: 'created' });
  } catch (error: unknown) {
    for (const item of created) {
      if (!item.closed) {
        try { await item.handle.close(); item.closed = true; } catch { /* Preserve the original setup failure. */ }
      }
    }
    if (root) for (const item of created) {
      try {
        const path = await root.resolve(['.memory-loop', item.name], 'file');
        const existing = await lstat(path, { bigint: true });
        if (item.identity && existing.dev === item.identity.dev && existing.ino === item.identity.ino) await unlink(path);
      } catch { /* Preserve unrelated files and report the setup failure. */ }
    }
    console.info('transport_setup_outcome', { status: 'failed' });
    throw normalizeError(error);
  } finally {
    for (const item of created) if (!item.closed) await item.handle.close().catch(() => {});
  }
}
