import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(import.meta.dirname, '..');
const bun = '/usr/bin/bun';
const fixturePath = '/usr/bin:/bin';
const roots: string[] = [];
const children: ChildProcess[] = [];

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture port unavailable');
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return address.port;
}
async function waitForFile(path: string, predicate: (value: string) => boolean) {
  for (let i = 0; i < 100; i++) {
    const value = await readFile(path, 'utf8').catch(() => '');
    if (predicate(value)) return value;
    await new Promise(resolveWait => setTimeout(resolveWait, 30));
  }
  throw new Error('fixture process did not become ready');
}
async function withDeadline<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 3000); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function birth(pid: number): Promise<string> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-restart-test-'));
  roots.push(root);
  for (const dir of ['.memory-loop', 'src/web', 'backend', 'scripts']) await mkdir(join(root, dir), { recursive: true });
  // A temporary copy runs the real package command, but its build and service
  // entrypoints are controlled processes and never touch the checkout's .next.
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  pkg.scripts.build = 'bun --no-env-file fixture-build.ts';
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await cp(join(source, 'scripts'), join(root, 'scripts'), { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  const events = join(root, 'events.log');
  await writeFile(events, '');
  await writeFile(join(root, 'fixture-build.ts'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(events)}, 'build\\n');\nprocess.exit(process.env.FIXTURE_BUILD_FAIL === '1' ? 7 : 0);\n`);
  const service = `import { appendFileSync } from 'node:fs';\nimport { createServer } from 'node:net';\nconst name=process.argv[2]; const port=Number(process.argv[3]);\nconst write=(s: string)=>appendFileSync(${JSON.stringify(events)},s+'\\n');\nconst server=createServer(socket=>socket.end());\nserver.listen(port,'127.0.0.1',()=>write('start '+name+' '+process.pid));\nprocess.on('SIGTERM',()=>server.close(()=>{write('stop '+name);process.exit(0)}));\n`;
  await writeFile(join(root, 'src/web/start.ts'), service);
  await writeFile(join(root, 'backend/runtime.ts'), service);
  const services = [];
  for (const [kind, name, pair] of [['daemon', 'daemon-one', 'one'], ['daemon', 'daemon-two', 'two'], ['web', 'web-one', 'one'], ['web', 'web-two', 'two']] as const) {
    const listener = await port();
    const script = join(root, kind === 'web' ? 'src/web/start.ts' : 'backend/runtime.ts');
    const args = ['--no-env-file', script, name, String(listener)];
    const transportFile = join(root, '.memory-loop', `${pair}.json`);
    const child = spawn(bun, args, { cwd: root, env: { NODE_ENV: 'test', PATH: fixturePath, HOME: root, MEMORY_LOOP_TRANSPORT_FILE: transportFile }, stdio: 'ignore' });
    children.push(child);
    if (!child.pid) throw new Error('fixture process did not start');
    await waitForFile(events, value => value.includes(`start ${name} ${child.pid}`));
    services.push({ kind, name, pid: child.pid, startTime: await birth(child.pid), cwd: root, executable: bun, args, transportFile });
  }
  const metadata = join(root, '.memory-loop/restart.json');
  await writeFile(metadata, JSON.stringify({ version: 1, services }));
  const invoke = (extra: Record<string, string> = {}) => spawnSync(bun, ['--no-env-file', 'run', '--cwd', root, 'restart'], {
    cwd: root, env: { NODE_ENV: 'test', PATH: fixturePath, HOME: root, ...extra }, encoding: 'utf8', timeout: 20000,
  });
  return { root, events, services, metadata, invoke };
}
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  for (const root of roots.splice(0)) {
    // Only test-owned service PIDs recorded in the test-owned event file are signalled.
    const text = await readFile(join(root, 'events.log'), 'utf8').catch(() => '');
    const owned: number[] = [];
    for (const match of text.matchAll(/^start (?:daemon-one|daemon-two|web-one|web-two) (\d+)$/gm)) {
      const pid = Number(match[1]);
      try {
        const cmd = await readFile(`/proc/${pid}/cmdline`, 'utf8');
        if (cmd.includes(root)) { process.kill(pid, 'SIGTERM'); owned.push(pid); }
      } catch { /* The owned process already exited. */ }
    }
    for (let i = 0; i < 100 && owned.length; i++) {
      for (let j = owned.length - 1; j >= 0; j--) {
        const stat = await readFile(`/proc/${owned[j]}/stat`, 'utf8').catch(() => '');
        if (!stat || stat.slice(stat.lastIndexOf(') ') + 2).startsWith('Z ')) owned.splice(j, 1);
      }
      if (owned.length) await new Promise(resolveWait => setTimeout(resolveWait, 30));
    }
    if (owned.length) throw new Error(`Owned fixture processes did not stop: ${owned.join(',')}`);
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== 'linux')('stops both managed webs before building and restarts the same managed settings', async () => {
  const f = await fixture();
  const result = f.invoke();
  expect(result.status, result.stderr).toBe(0);
  const text = await waitForFile(f.events, value => (value.match(/^start /gm) ?? []).length === 8);
  const lines = text.trim().split('\n');
  const build = lines.indexOf('build');
  expect(build).toBeGreaterThan(lines.indexOf('stop web-one'));
  expect(build).toBeGreaterThan(lines.indexOf('stop web-two'));
  expect(lines.indexOf('stop web-one')).toBeGreaterThanOrEqual(0);
  expect(lines.indexOf('stop web-two')).toBeGreaterThanOrEqual(0);
  const state = JSON.parse(await readFile(f.metadata, 'utf8'));
  expect(state.version).toBe(1);
  expect(state.services).toHaveLength(4);
  for (const old of f.services) {
    const next = state.services.find((entry: { name: string }) => entry.name === old.name);
    expect(next).toMatchObject({ kind: old.kind, cwd: old.cwd, executable: old.executable, args: old.args, transportFile: old.transportFile });
    expect(next.pid).not.toBe(old.pid);
    expect(next.startTime).toBe(await birth(next.pid));
  }
});

it.skipIf(process.platform !== 'linux')('starts recorded services after their processes have exited, as after a reboot', async () => {
  const f = await fixture();
  for (const child of children) child.kill('SIGTERM');
  await waitForFile(f.events, value => (value.match(/^stop /gm) ?? []).length === 4);
  const result = f.invoke();
  expect(result.status, result.stderr).toBe(0);
  const text = await waitForFile(f.events, value => (value.match(/^start /gm) ?? []).length === 8);
  expect(text).toMatch(/^build$/m);
});

it.skipIf(process.platform !== 'linux')('accepts the recorded service executable when restart uses a different Bun binary', async () => {
  const f = await fixture();
  const bin = join(f.root, 'bin');
  await mkdir(bin);
  await copyFile(bun, join(bin, 'bun'));
  const result = f.invoke({ PATH: `${bin}:${fixturePath}` });
  expect(result.status, result.stderr).toBe(0);
});

it.skipIf(process.platform !== 'linux')('refuses an unrelated PID before stopping any managed service or building', async () => {
  const f = await fixture();
  const sentinel = spawn(bun, ['--no-env-file', '-e', 'setInterval(() => {}, 1000)'], { cwd: f.root, env: { NODE_ENV: 'test', PATH: fixturePath, HOME: f.root }, stdio: 'ignore' });
  children.push(sentinel);
  if (!sentinel.pid) throw new Error('sentinel missing');
  const sentinelPid = sentinel.pid;
  const state = JSON.parse(await readFile(f.metadata, 'utf8'));
  state.services[2].pid = sentinelPid;
  state.services[2].startTime = await birth(sentinelPid);
  await writeFile(f.metadata, JSON.stringify(state));
  const result = f.invoke();
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain('Managed PID ownership check failed: web-one');
  const text = await readFile(f.events, 'utf8');
  expect(text).not.toMatch(/^(?:stop |build$)/m);
  expect(() => process.kill(sentinelPid, 0)).not.toThrow();
});

it.skipIf(process.platform !== 'linux')('reports build failure and does not pretend the services restarted', async () => {
  const f = await fixture();
  const result = f.invoke({ FIXTURE_BUILD_FAIL: '1' });
  expect(result.status).not.toBe(0);
  const text = await readFile(f.events, 'utf8');
  expect(text).toMatch(/^build$/m);
  expect((text.match(/^start /gm) ?? [])).toHaveLength(4);
  expect(result.stdout + result.stderr).not.toMatch(/\bready\b/i);
});

it.skipIf(process.platform !== 'linux').each(['existing-lock', 'invalid-metadata'] as const)(
  'refuses a simulated Windows managed restart before inspecting %s', async obstacle => {
    const root = await mkdtemp(join(tmpdir(), 'memory-loop-restart-test-'));
    roots.push(root);
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, '.memory-loop'));
    await copyFile(join(source, 'scripts', 'restart.ts'), join(root, 'scripts', 'restart.ts'));
    const events = join(root, 'events.log');
    await writeFile(events, '');
    const metadata = join(root, '.memory-loop', 'restart.json');
    const lock = join(root, '.memory-loop', 'restart.lock');
    await writeFile(metadata, 'fixture invalid metadata');
    if (obstacle === 'existing-lock') await writeFile(lock, 'fixture lock sentinel');
    const preload = join(root, 'simulated-windows.ts');
    await writeFile(preload, `import { appendFileSync } from 'node:fs';\nObject.defineProperty(process, 'platform', { value: 'win32' });\nprocess.kill = () => { appendFileSync(${JSON.stringify(events)}, 'unexpected kill\\n'); throw new Error('unexpected kill'); };\n`);
    const result = spawnSync(bun, ['--no-env-file', '--preload', preload, join(root, 'scripts', 'restart.ts')], {
      cwd: root, env: { NODE_ENV: 'test', PATH: fixturePath, HOME: root }, encoding: 'utf8', timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/windows|unsupported/i);
    expect(output).toMatch(/daemon/i);
    expect(output).toMatch(/web/i);
    expect(output).toMatch(/ctrl\s*\+\s*c|sigint/i);
    expect(output).not.toMatch(/EEXIST|Invalid restart metadata/);
    expect(await readFile(metadata, 'utf8')).toBe('fixture invalid metadata');
    expect(await readFile(events, 'utf8')).toBe('');
    if (obstacle === 'existing-lock') expect(await readFile(lock, 'utf8')).toBe('fixture lock sentinel');
    else await expect(lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.skipIf(process.platform !== 'linux')('forwards SIGINT to the owned web child and waits for its graceful drain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-restart-test-'));
  roots.push(root);
  for (const dir of ['src/web', 'backend', '.memory-loop', 'node_modules/next/dist/bin']) await mkdir(join(root, dir), { recursive: true });
  await copyFile(join(source, 'src/web/start.ts'), join(root, 'src/web/start.ts'));
  await copyFile(join(source, 'src/web/shutdown-policy.ts'), join(root, 'src/web/shutdown-policy.ts'));
  for (const name of ['transport.ts', 'safe-fs.ts', 'portable-name.ts']) await copyFile(join(source, 'backend', name), join(root, 'backend', name));
  await writeFile(join(root, '.memory-loop', 'transport.json'), JSON.stringify({ daemonOrigin: 'http://127.0.0.1:3001' }));
  await writeFile(join(root, '.memory-loop', 'service.token'), 'a'.repeat(64));
  const events = join(root, 'events.log');
  await writeFile(events, '');
  await writeFile(join(root, 'node_modules/next/dist/bin/next'), `const { appendFileSync } = require('node:fs');\nconst log = value => appendFileSync(${JSON.stringify(events)}, value + '\\n');\nprocess.on('SIGINT', () => { log('child SIGINT'); setTimeout(() => { log('child drained'); process.exit(0); }, 150); });\nlog('child ready');\nsetInterval(() => {}, 1000);\n`);
  const launcher = spawn(bun, ['--no-env-file', join(root, 'src/web/start.ts'), 'start'], {
    cwd: root, detached: true, env: { NODE_ENV: 'test', PATH: fixturePath, HOME: root }, stdio: 'pipe',
  });
  children.push(launcher);
  let logs = '';
  launcher.stdout?.on('data', data => { logs += String(data); });
  launcher.stderr?.on('data', data => { logs += String(data); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    launcher.once('error', reject);
    launcher.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let complete = false;
  try {
    await waitForFile(events, value => value.includes('child ready'));
    launcher.kill('SIGINT');
    const result = await withDeadline(exited, 'Owned launcher did not stop');
    expect(result).toEqual({ code: 0, signal: null });
    expect(await readFile(events, 'utf8')).toBe('child ready\nchild SIGINT\nchild drained\n');
    expect(logs).toMatch(/web_shutdown_outcome[\s\S]*?status\s*:\s*['"]?complete/);
    complete = true;
  } finally {
    if (!complete && launcher.pid) {
      try { process.kill(-launcher.pid, 'SIGTERM'); } catch { /* Owned process group already exited. */ }
      await withDeadline(exited.catch(() => undefined), 'Owned launcher cleanup timed out');
    }
  }
}, 10000);
