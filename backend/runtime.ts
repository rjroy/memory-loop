import { serve } from 'bun';
import { isAbsolute } from 'node:path';
import { prepareServer } from './server';
import { defaultProjectRoot, transportFileFor } from './runtime-options';
import { loadTransport } from './transport';
import { hardUploadMaxBytes } from './contract';

interface RuntimeOptions {
  projectRoot: string;
  port?: number;
}

function optionsFromArgs(args: string[]): RuntimeOptions {
  let projectRoot = defaultProjectRoot;
  let port: number | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (seen.has(flag) || value === undefined) throw new Error('Invalid runtime arguments');
    seen.add(flag);
    if (flag === '--project-root' && isAbsolute(value)) projectRoot = value;
    else if (flag === '--port' && /^\d+$/.test(value)) {
      port = Number(value);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid runtime arguments');
    } else throw new Error('Invalid runtime arguments');
  }
  return { projectRoot, port };
}

async function main(): Promise<void> {
  const options = optionsFromArgs(process.argv.slice(2));
  console.info('daemon_start_attempt');
  const transport = await loadTransport(transportFileFor(options.projectRoot));
  const port = Number(new URL(transport.config.daemonOrigin).port || 80);
  if (options.port !== undefined && options.port !== port) throw new Error('Daemon port does not match transport configuration');
  const authority = `127.0.0.1:${port}`;
  const prepared = await prepareServer({
    projectRoot: options.projectRoot,
    authority,
  });
  let server: ReturnType<typeof serve>;
  try {
    server = serve({
      hostname: '127.0.0.1', port, development: false, maxRequestBodySize: hardUploadMaxBytes,
      async fetch(request, listener) {
        if (request.method === 'POST' && new URL(request.url).pathname === '/api/vault/attachments') listener.timeout(request, 0);
        const response = await prepared.fetch(request);
        // Accepted watches have their own lease and write deadlines. Bun's default
        // idle timeout is shorter than the watch heartbeat; leave it unchanged for
        // all other requests and let those watch-specific bounds govern the stream.
        if (request.method === 'GET' && response.status === 200 &&
            /^\/api\/think\/conversations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/events$/.test(new URL(request.url).pathname) &&
            /^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) {
          listener.timeout(request, 0);
        }
        return response;
      },
    });
  } catch (error: unknown) {
    await prepared.close();
    throw error;
  }
  console.info('daemon_start_outcome', { status: 'listening', port });
  prepared.startRecovery();

  let shuttingDown = false;
  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info('daemon_shutdown_attempt', { signal });
    const timeout = setTimeout(() => {
      console.error('daemon_shutdown_outcome', { status: 'timeout' });
      process.exit(1);
    }, 2500);
    timeout.unref();
    try {
      await server.stop(true);
      await prepared.close();
      console.info('daemon_shutdown_outcome', { status: 'complete' });
      clearTimeout(timeout);
      process.exitCode = 0;
    } catch {
      clearTimeout(timeout);
      console.error('daemon_shutdown_outcome', { status: 'failed' });
      process.exitCode = 1;
    }
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const reason = code === 'EADDRINUSE' ? 'EADDRINUSE' :
    code === 'transport_invalid' || code === 'transport_unavailable' || code === 'transport_exists' ? 'transport_unavailable' :
      error instanceof Error && error.message === 'Daemon port does not match transport configuration' ? 'port_mismatch' : 'startup_failed';
  console.error('daemon_start_outcome', { status: 'failed', reason });
  process.exitCode = 1;
});
