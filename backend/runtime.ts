import { serve } from 'bun';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareServer } from './server';

interface RuntimeOptions {
  projectRoot: string;
  distDirectory: string;
  port: number;
  devOrigin?: string;
}

function parseDevOrigin(value: string): string {
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/.exec(value);
  if (!match || (match[1] !== undefined && (Number(match[1]) < 1 || Number(match[1]) > 65535))) {
    throw new Error('Invalid runtime arguments');
  }
  return new URL(value).origin;
}

function optionsFromArgs(args: string[]): RuntimeOptions {
  let projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  let distDirectory: string | undefined;
  let port = 3000;
  let devOrigin: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (seen.has(flag) || value === undefined) throw new Error('Invalid runtime arguments');
    seen.add(flag);
    if (flag === '--project-root' && isAbsolute(value)) projectRoot = value;
    else if (flag === '--dist' && isAbsolute(value)) distDirectory = value;
    else if (flag === '--dev-origin') devOrigin = parseDevOrigin(value);
    else if (flag === '--port' && /^\d+$/.test(value)) {
      port = Number(value);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid runtime arguments');
    } else throw new Error('Invalid runtime arguments');
  }
  return { projectRoot, distDirectory: distDirectory ?? join(projectRoot, 'dist'), port, devOrigin };
}

async function main(): Promise<void> {
  const options = optionsFromArgs(process.argv.slice(2));
  const authority = `127.0.0.1:${options.port}`;
  console.info('daemon_start_attempt', { port: options.port });
  const prepared = await prepareServer({
    projectRoot: options.projectRoot,
    distDirectory: options.distDirectory,
    authority,
    allowedOrigins: [`http://${authority}`, ...(options.devOrigin === undefined ? [] : [options.devOrigin])],
  });
  let server: ReturnType<typeof serve>;
  try {
    server = serve({ hostname: '127.0.0.1', port: options.port, development: false, fetch: prepared.fetch });
  } catch (error: unknown) {
    await prepared.close();
    throw error;
  }
  console.info('daemon_start_outcome', { status: 'listening', port: options.port });

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
  console.error('daemon_start_outcome', { status: 'failed', reason: code === 'EADDRINUSE' ? 'EADDRINUSE' : 'startup_failed' });
  process.exitCode = 1;
});
