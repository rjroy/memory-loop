export interface ServerOptions {
  /** Directory containing .memory-loop/config.json; defaults at the CLI to project root. */
  projectRoot: string;
  /** Built frontend directory; supplied explicitly to avoid serving the vault. */
  distDirectory: string;
  /** Exact loopback authority including the chosen port. */
  authority: string;
  allowedOrigins: readonly string[];
}

export interface PreparedServer {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

type StaticResult = { content: Uint8Array<ArrayBuffer> } | { missing: boolean };

async function readStatic(root: FileHandle, components: string[]): Promise<StaticResult> {
  const opened: FileHandle[] = [];
  try {
    let parent = root;
    for (const component of components.slice(0, -1)) {
      parent = await open(`/proc/self/fd/${parent.fd}/${component}`, directoryFlags);
      opened.push(parent);
    }
    const file = await open(`/proc/self/fd/${parent.fd}/${components[components.length - 1]}`, fileFlags);
    opened.push(file);
    if (!(await file.stat()).isFile()) return { missing: false };
    return { content: Uint8Array.from(await file.readFile()) };
  } catch (error: unknown) {
    return { missing: typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' };
  } finally {
    for (const handle of opened.reverse()) await handle.close();
  }
}

function staticResponse(result: StaticResult, name: string): Response {
  if (!('content' in result)) return new Response('Not found', { status: 404 });
  return new Response(result.content, { headers: {
    'Content-Type': contentTypes[extname(name).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  } });
}

/** Prepare the configured API and static application without starting a listener. */
export async function prepareServer(options: ServerOptions): Promise<PreparedServer> {
  const transport = await loadTransport(transportFileFor(options.projectRoot));
  if (transport.config.daemonOrigin !== `http://${options.authority}`) throw new Error('Daemon port does not match transport configuration');
  if (process.platform !== 'linux' || !constants.O_DIRECTORY || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    throw new Error('Static serving is unavailable');
  }
  const dist = await open(options.distDirectory, directoryFlags);
  let vault: VaultState;
  try {
    const config = await loadConfig(options.projectRoot);
    vault = { reader: await openVault(config.vaultDirectory) };
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    vault = { error: code === 'config_missing' || code === 'config_invalid' ? code : 'vault_unavailable' };
  }
  let api: ReturnType<typeof createApp>;
  try { api = createApp({ authority: options.authority, serviceToken: transport.serviceToken, vault }); }
  catch (error) {
    try { if ('reader' in vault) await vault.reader.close(); } finally { await dist.close(); }
    throw error;
  }
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request);
      const origin = request.headers.get('origin');
      if (request.headers.get('host') !== options.authority ||
          (origin !== null && (origin === 'null' || !options.allowedOrigins.includes(origin))) ||
          request.headers.get('sec-fetch-site') === 'cross-site') {
        return new Response('Forbidden', { status: 403 });
      }
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return new Response('Not found', { status: 404 }); }
      const components = path.slice(1).split('/');
      if (path === '/') components.splice(0, 1, 'index.html');
      if (components.some(component => !component || component.startsWith('.') || component.includes('\\') || component.includes('\0')) ||
          /%2f|%5c/i.test(url.pathname)) return new Response('Not found', { status: 404 });
      const result = await readStatic(dist, components);
      if ('content' in result) return staticResponse(result, components[components.length - 1]);
      const navigation = result.missing && !components.includes('assets') && !extname(components[components.length - 1]) &&
        request.headers.get('accept')?.split(',').some(value => value.trim().startsWith('text/html'));
      if (navigation) return staticResponse(await readStatic(dist, ['index.html']), 'index.html');
      return new Response('Not found', { status: 404 });
    },
    async close() {
      try {
        if ('reader' in vault) await vault.reader.close();
      } finally {
        await dist.close();
      }
    },
  };
}
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
import { createApp, type VaultState } from './app';
import { loadConfig } from './config';
import { openVault } from './vault';
import { loadTransport } from './transport';
import { transportFileFor } from './runtime-options';
