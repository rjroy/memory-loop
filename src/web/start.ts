import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTransport } from '../../backend/transport';
import { webSignalAction } from './shutdown-policy';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== 'start' && mode !== 'dev') throw new Error('invalid_arguments');
  console.info('web_start_attempt', { mode });
  const file = process.env.MEMORY_LOOP_TRANSPORT_FILE ?? join(projectRoot, '.memory-loop', 'transport.json');
  if (!isAbsolute(file)) throw new Error('transport_unavailable');
  await loadTransport(file);
  // Bun launches the supported Node CLI, never a custom HTTP server. The absolute
  // selector survives Next bundling and an operator's unrelated working directory.
  const child = spawn('node', [join(projectRoot, 'node_modules/next/dist/bin/next'), mode, projectRoot,
    ...args], {
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
    if (webSignalAction(process.platform, signal) === 'forward') {
      child.kill(signal);
      timeout = setTimeout(() => { child.kill('SIGKILL'); }, 4000);
      timeout.unref();
    }
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
  const reason = error instanceof Error && error.message === 'invalid_arguments'
    ? error.message : 'transport_or_startup_unavailable';
  console.error('web_start_outcome', { status: 'failed', reason });
  process.exitCode = 1;
});
