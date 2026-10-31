import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';

export type TransportConfig = {
  daemonOrigin: string;
  web: { mode: 'loopback'; origin: string }
    | { mode: 'tailscale'; origin: string; allowedLogin: string }
    | { mode: 'reverse-proxy'; origin: string; externalAuth: 'operator-managed' };
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
function origin(value: unknown, mode: 'daemon' | 'loopback' | 'tailscale' | 'reverse-proxy'): string {
  if (typeof value !== 'string') return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.origin !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return invalid();
  if (mode === 'tailscale') {
    if (url.protocol !== 'https:' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(url.hostname)) return invalid();
  } else if (mode === 'reverse-proxy') {
    const labels = url.hostname.split('.');
    if (url.protocol !== 'https:' || labels.length < 2 || url.hostname.length > 253 ||
        labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
        labels.every(label => /^\d+$/.test(label))) return invalid();
  } else if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return invalid();
  return value;
}

export function parseTransport(value: unknown): TransportConfig {
  if (!record(value) || !record(value.web)) return invalid();
  const daemonOrigin = origin(value.daemonOrigin, 'daemon');
  const web = value.web;
  if (web.mode === 'loopback') return { daemonOrigin, web: { mode: 'loopback', origin: origin(web.origin, 'loopback') } };
  if (web.mode === 'tailscale') {
    if (typeof web.allowedLogin !== 'string' || !/^[^\s*@]+@[^\s*@]+$/.test(web.allowedLogin)) return invalid();
    return { daemonOrigin, web: { mode: 'tailscale', origin: origin(web.origin, 'tailscale'), allowedLogin: web.allowedLogin } };
  }
  if (web.mode === 'reverse-proxy') {
    if (web.externalAuth !== 'operator-managed') return invalid();
    return { daemonOrigin, web: { mode: 'reverse-proxy', origin: origin(web.origin, 'reverse-proxy'), externalAuth: 'operator-managed' } };
  }
  return invalid();
}

const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
function descriptor(dir: FileHandle, name: string) { return `/proc/self/fd/${dir.fd}/${name}`; }
async function check(handle: FileHandle, directory: boolean): Promise<void> {
  const stat = await handle.stat();
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
      !process.getuid || stat.uid !== process.getuid()) invalid();
}
async function metadata(path: string): Promise<FileHandle> {
  if (process.platform !== 'linux' || !constants.O_DIRECTORY || !constants.O_NOFOLLOW || !isAbsolute(path)) invalid();
  const dir = await open(path, dirFlags);
  try { await check(dir, true); return dir; } catch (error) { await dir.close(); throw error; }
}
async function readPrivate(dir: FileHandle, name: string): Promise<string> {
  const file = await open(descriptor(dir, name), fileFlags);
  try { await check(file, false); return await file.readFile('utf8'); } finally { await file.close(); }
}
function normalizeError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return new TransportError(code === 'EEXIST' ? 'transport_exists' : 'transport_unavailable');
}

export async function loadTransport(transportFile: string): Promise<LoadedTransport> {
  let dir: FileHandle | undefined;
  try {
    if (!isAbsolute(transportFile) || transportFile !== join(dirname(transportFile), 'transport.json')) invalid();
    dir = await metadata(dirname(transportFile));
    let data: unknown;
    try { data = JSON.parse(await readPrivate(dir, 'transport.json')); } catch (error) {
      if (error instanceof SyntaxError) invalid();
      throw error;
    }
    const config = parseTransport(data);
    const serviceToken = await readPrivate(dir, 'service.token');
    if (!/^[a-f0-9]{64}$/.test(serviceToken)) invalid();
    return { config, serviceToken };
  } catch (error: unknown) { throw normalizeError(error); }
  finally { await dir?.close(); }
}

export async function setupTransport(projectRoot: string): Promise<void> {
  console.info('transport_setup_attempt');
  let dir: FileHandle | undefined;
  const created: Array<{ name: string; handle: FileHandle }> = [];
  try {
    if (!isAbsolute(projectRoot)) invalid();
    const path = join(projectRoot, '.memory-loop');
    try { await mkdir(path, { mode: 0o700 }); } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    dir = await metadata(path);
    const config: TransportConfig = { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } };
    for (const [name, content] of [['service.token', randomBytes(32).toString('hex')], ['transport.json', `${JSON.stringify(config, null, 2)}\n`]]) {
      const handle = await open(descriptor(dir, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created.push({ name, handle });
      await handle.writeFile(content, 'utf8');
    }
    console.info('transport_setup_outcome', { status: 'created' });
  } catch (error: unknown) {
    if (dir) for (const item of created) {
      try {
        const existing = await lstat(descriptor(dir, item.name));
        const ours = await item.handle.stat();
        if (existing.dev === ours.dev && existing.ino === ours.ino) await unlink(descriptor(dir, item.name));
      } catch { /* Preserve unrelated files and report the setup failure. */ }
    }
    console.info('transport_setup_outcome', { status: 'failed' });
    throw normalizeError(error);
  } finally {
    for (const item of created) await item.handle.close();
    await dir?.close();
  }
}
