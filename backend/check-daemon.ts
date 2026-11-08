import { request } from 'node:http';
import { projectRootFromArgs, transportFileFor } from './runtime-options';
import { loadTransport } from './transport';
import type { VaultTreeResponse } from './contract';

const maxTreeBytes = 16 * 1024 * 1024;

function isTree(value: unknown): value is VaultTreeResponse {
  const object = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item);
  const validEntries = (entries: unknown, parent: string[]): boolean => Array.isArray(entries) && entries.every(entry => {
    if (!object(entry) || typeof entry.name !== 'string' || !entry.name || entry.name.startsWith('.') ||
        /[/\\\0]/.test(entry.name) || !Array.isArray(entry.id) ||
        entry.id.length !== parent.length + 1 || !entry.id.every((part, index) => part === [...parent, entry.name][index])) return false;
    if (entry.kind === 'note') return entry.name.endsWith('.md');
    if (entry.kind === 'file') return true;
    return entry.kind === 'directory' && validEntries(entry.children, [...parent, entry.name]);
  });
  return object(value) && validEntries(value.entries, []);
}

async function main() {
  const root = projectRootFromArgs(process.argv.slice(2));
  const transport = await loadTransport(transportFileFor(root));
  console.info('daemon_check_attempt');
  const result = await new Promise<{ status: number; valid: boolean }>((resolve, reject) => {
    const call = request(new URL('/api/vault/tree', transport.config.daemonOrigin), {
      method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${transport.serviceToken}` },
      signal: AbortSignal.timeout(3000),
    }, response => {
      const status = response.statusCode ?? 0;
      const mime = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (status !== 200 || mime !== 'application/json') {
        response.resume();
        response.once('end', () => resolve({ status, valid: false }));
        response.once('error', reject);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxTreeBytes) { response.destroy(new Error('Daemon response too large')); return; }
        chunks.push(chunk);
      });
      response.once('end', () => {
        try { resolve({ status, valid: isTree(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); }
        catch { resolve({ status, valid: false }); }
      });
      response.once('error', reject);
    });
    call.setTimeout(3000, () => call.destroy(new Error('Daemon check timed out')));
    call.once('error', reject);
    call.end();
  });
  console.info('daemon_check_outcome', { status: result.status, valid: result.valid });
  if (!result.valid) process.exitCode = 1;
}

main().catch(() => {
  console.error('daemon_check_outcome', { status: 'unavailable' });
  process.exitCode = 1;
});
