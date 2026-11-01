import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

it('stops both managed webs before building and restarts the same managed settings', async () => {
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

it('refuses an unrelated PID before stopping any managed service or building', async () => {
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

it('reports build failure and does not pretend the services restarted', async () => {
  const f = await fixture();
  const result = f.invoke({ FIXTURE_BUILD_FAIL: '1' });
  expect(result.status).not.toBe(0);
  const text = await readFile(f.events, 'utf8');
  expect(text).toMatch(/^build$/m);
  expect((text.match(/^start /gm) ?? [])).toHaveLength(4);
  expect(result.stdout + result.stderr).not.toMatch(/\bready\b/i);
});
