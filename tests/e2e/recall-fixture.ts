import { test as base } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const executable = fileURLToPath(new URL('../../backend/runtime.ts', import.meta.url));
const dist = join(projectRoot, 'dist');

export const hostileMarkdown = [
  '# Source heading',
  '<script>window.recallScriptRan = true</script>',
  '',
  '<img src="http://127.0.0.1:9/remote-sentinel">',
  '',
  '![test image](./local-sentinel.png)',
  '[unsafe](javascript:alert(1)) [web](https://example.invalid/test) [relative](other.md)',
  '- [x] task fixture',
  '',
  '| A | B |', '| --- | --- |', `| ${'wide'.repeat(90)} | cell |`,
  '', '```', 'wide-code-'.repeat(100), '```',
  ...Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'fixture prose '.repeat(12)}`),
].join('\n');

function exited(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  try {
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
}

export const test = base.extend<object, { recallOrigin: string }>({
  recallOrigin: [async ({}, use) => {
    const fixture = await mkdtemp(join(tmpdir(), 'memory-loop-browser-'));
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      const app = join(fixture, 'app');
      const vault = join(fixture, 'vault');
      await mkdir(join(app, '.memory-loop'), { recursive: true });
      await mkdir(join(vault, 'folder'), { recursive: true });
      await writeFile(join(app, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault }));
      await writeFile(join(vault, 'alpha.md'), '# Alpha heading\n\nAlpha fixture body.\n');
      await writeFile(join(vault, 'folder', 'beta.md'), '# Beta heading\n\nBeta fixture body.\n');
      await writeFile(join(vault, 'danger.md'), hostileMarkdown);
      await writeFile(join(vault, 'empty.md'), '');
      await writeFile(join(vault, 'local-sentinel.png'), 'fixture-not-an-image');
      const port = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      child = spawn('bun', ['--no-env-file', executable, '--project-root', app, '--dist', dist, '--port', String(port)],
        { cwd: fixture, stdio: 'pipe' });
      child.stdout.resume();
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (text: string) => { stderr += text; });
      const deadline = Date.now() + 5000;
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Fixture daemon exited: ${stderr}`);
        try {
          const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(250) });
          if (response.status === 200) { ready = true; break; }
        } catch { /* The owned listener is not ready yet. */ }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!ready) throw new Error(`Fixture daemon did not become ready: ${stderr}`);
      await use(origin);
    } finally {
      try {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exit = exited(child);
          child.kill('SIGTERM');
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([exit, new Promise<void>(resolve => { timeout = setTimeout(resolve, 3000); })]);
          } finally { if (timeout) clearTimeout(timeout); }
          if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited(child); }
        }
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  }, { scope: 'worker' }],
});

export { expect } from '@playwright/test';
