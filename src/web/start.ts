import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTransport } from '../../backend/transport';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== 'start' && mode !== 'dev') throw new Error('invalid_arguments');
  let port = 3000;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) throw new Error('invalid_arguments');
    port = Number(args[1]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid_arguments');
  }
  console.info('web_start_attempt', { mode, port });
  const file = process.env.MEMORY_LOOP_TRANSPORT_FILE ?? join(projectRoot, '.memory-loop', 'transport.json');
  if (!isAbsolute(file)) throw new Error('transport_unavailable');
  const transport = await loadTransport(file);
  if (transport.config.web.mode === 'loopback' && transport.config.web.origin !== `http://127.0.0.1:${port}`) throw new Error('port_mismatch');
  // Bun launches the supported Node CLI, never a custom HTTP server. The absolute
  // selector survives Next bundling and an operator's unrelated working directory.
  const child = spawn('node', [join(projectRoot, 'node_modules/next/dist/bin/next'), mode, projectRoot,
    '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: projectRoot,
    env: { ...process.env, MEMORY_LOOP_TRANSPORT_FILE: file },
    stdio: 'inherit',
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  const stop = (signal: 'SIGINT' | 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    console.info('web_shutdown_attempt', { signal });
    child.kill(signal);
    timeout = setTimeout(() => { child.kill('SIGKILL'); }, 4000);
    timeout.unref();
  };
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (status, signal) => resolve(status ?? (stopping && signal !== 'SIGKILL' ? 0 : 1)));
    });
    console.info(stopping ? 'web_shutdown_outcome' : 'web_exit_outcome', { status: code === 0 ? 'complete' : 'failed' });
    process.exitCode = code;
  } finally {
    if (timeout) clearTimeout(timeout);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error && (error.message === 'invalid_arguments' || error.message === 'port_mismatch')
    ? error.message : 'transport_or_startup_unavailable';
  console.error('web_start_outcome', { status: 'failed', reason });
  process.exitCode = 1;
});
