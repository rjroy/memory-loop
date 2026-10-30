import { expect, it } from 'vitest';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, preview as createVitePreview } from 'vite';
import { prepareServer, type PreparedServer } from './server';

const viteConfig = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
}

it('keeps the transitional Vite proxy from bypassing the private daemon boundary', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'memory-loop-proxy-test-'));
  let prepared: PreparedServer | undefined;
  const daemon = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    if (!prepared) { response.writeHead(503).end(); return; }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (value) for (const item of value) headers.append(name, item);
    }
    const address = daemon.address();
    if (!address || typeof address === 'string') { response.writeHead(500).end(); return; }
    const upstream = new Request(`http://127.0.0.1:${address.port}${request.url ?? '/'}`, { method: request.method, headers });
    void prepared.fetch(upstream).then(async result => {
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      response.end(Buffer.from(await result.arrayBuffer()));
    }).catch(() => { response.writeHead(500).end(); });
  });
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  try {
    const projectRoot = join(fixture, 'project');
    const vault = join(fixture, 'vault');
    const dist = join(fixture, 'dist');
    await mkdir(join(projectRoot, '.memory-loop'), { recursive: true, mode: 0o700 });
    await mkdir(join(vault, 'folder'), { recursive: true });
    await mkdir(dist);
    await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault }));
    await writeFile(join(vault, 'folder', 'note.md'), '# Proxy fixture\n');

    await new Promise<void>((resolve, reject) => {
      daemon.once('error', reject);
      daemon.listen(0, '127.0.0.1', resolve);
    });
    const daemonAddress = daemon.address();
    if (!daemonAddress || typeof daemonAddress === 'string') throw new Error('Expected a daemon TCP address');
    const daemonAuthority = `127.0.0.1:${daemonAddress.port}`;
    await writeFile(join(projectRoot, '.memory-loop', 'transport.json'), JSON.stringify({ daemonOrigin: `http://${daemonAuthority}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
    await writeFile(join(projectRoot, '.memory-loop', 'service.token'), 'a'.repeat(64), { mode: 0o600 });
    const vitePort = await freePort();
    const frontendOrigin = `http://127.0.0.1:${vitePort}`;
    prepared = await prepareServer({ projectRoot, distDirectory: dist, authority: daemonAuthority, allowedOrigins: [frontendOrigin] });

    const previous = process.env.MEMORY_LOOP_DAEMON_URL;
    process.env.MEMORY_LOOP_DAEMON_URL = `http://${daemonAuthority}`;
    try {
      vite = await createViteServer({ configFile: viteConfig, logLevel: 'silent', server: { host: '127.0.0.1', port: vitePort, strictPort: true } });
    } finally {
      if (previous === undefined) delete process.env.MEMORY_LOOP_DAEMON_URL;
      else process.env.MEMORY_LOOP_DAEMON_URL = previous;
    }
    await vite.listen();
    const shell = await fetch(`${frontendOrigin}/recall`, { headers: { accept: 'text/html' } });
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-type')).toContain('text/html');

    const tree = await fetch(`${frontendOrigin}/api/vault/tree`, { headers: { origin: frontendOrigin, 'sec-fetch-site': 'same-origin' } });
    expect(tree.status).toBe(403);
    expect(tree.headers.get('content-type')).toContain('application/json');
    expect(tree.headers.get('cache-control')).toBe('no-store');
    expect(await tree.text()).not.toContain('note.md');

    const query = new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) });
    const note = await fetch(`${frontendOrigin}/api/vault/note?${query}`, { headers: { origin: frontendOrigin } });
    expect(note.status).toBe(403);
    expect(note.headers.get('cache-control')).toBe('no-store');
    expect(await note.text()).not.toContain('Proxy fixture');

    const hostile = await fetch(`${frontendOrigin}/api/vault/tree`, { headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect(hostile.status).toBe(403);
    expect(hostile.headers.get('cache-control')).toBe('no-store');
    expect(hostile.headers.get('access-control-allow-origin')).toBeNull();
  } finally {
    try {
      await vite?.close();
    } finally {
      try {
        if (daemon.listening) await new Promise<void>((resolve, reject) => daemon.close(error => error ? reject(error) : resolve()));
        await prepared?.close();
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  }
}, 15000);

it('RECALL-INT-001: static preview never forwards no-Origin vault API requests to the daemon', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'memory-loop-preview-test-'));
  const sentinel = 'fixture-only-preview-secret';
  const upstreamRequests: Array<{ path: string; origin: string | undefined }> = [];
  const daemon = createHttpServer((request, response) => {
    upstreamRequests.push({ path: request.url ?? '', origin: request.headers.origin });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ markdown: sentinel }));
  });
  let preview: Awaited<ReturnType<typeof createVitePreview>> | undefined;
  try {
    await mkdir(join(fixture, 'dist'));
    await writeFile(join(fixture, 'dist', 'index.html'), '<!doctype html><title>Fixture preview</title>');
    await new Promise<void>((resolve, reject) => {
      daemon.once('error', reject);
      daemon.listen(0, '127.0.0.1', resolve);
    });
    const address = daemon.address();
    if (!address || typeof address === 'string') throw new Error('Expected a daemon TCP address');
    const port = await freePort();
    const previous = process.env.MEMORY_LOOP_DAEMON_URL;
    process.env.MEMORY_LOOP_DAEMON_URL = `http://127.0.0.1:${address.port}`;
    try {
      preview = await createVitePreview({
        configFile: viteConfig, root: fixture, logLevel: 'silent',
        build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port, strictPort: true },
      });
    } finally {
      if (previous === undefined) delete process.env.MEMORY_LOOP_DAEMON_URL;
      else process.env.MEMORY_LOOP_DAEMON_URL = previous;
    }
    const base = `http://127.0.0.1:${port}`;
    const note = await fetch(`${base}/api/vault/note?id=%5B%22note.md%22%5D`);
    const noteBody = await note.text();
    const tree = await fetch(`${base}/api/vault/tree`);
    const treeBody = await tree.text();
    expect(upstreamRequests).toEqual([]);
    expect(noteBody).not.toContain(sentinel);
    expect(treeBody).not.toContain(sentinel);
  } finally {
    try {
      if (preview) await new Promise<void>((resolve, reject) => preview?.httpServer.close(error => error ? reject(error) : resolve()));
    } finally {
      try {
        if (daemon.listening) await new Promise<void>((resolve, reject) => daemon.close(error => error ? reject(error) : resolve()));
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  }
}, 15000);

it.each([
  'http://example.invalid:3000',
  'http://user:secret@127.0.0.1:3000',
  'http://127.0.0.1:3000/path',
  'http://127.0.0.1:3000/?query=value',
])('rejects unsafe server-side proxy targets', async target => {
  const previous = process.env.MEMORY_LOOP_DAEMON_URL;
  process.env.MEMORY_LOOP_DAEMON_URL = target;
  try {
    await expect(createViteServer({ configFile: viteConfig, logLevel: 'silent' }))
      .rejects.toThrow('Invalid loopback daemon URL');
  } finally {
    if (previous === undefined) delete process.env.MEMORY_LOOP_DAEMON_URL;
    else process.env.MEMORY_LOOP_DAEMON_URL = previous;
  }
});
