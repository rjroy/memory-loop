import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { open, readFile, readlink, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Service = { kind: 'web' | 'daemon'; name: string; pid: number; startTime: string; cwd: string; executable: string; args: string[]; transportFile: string };
type State = { version: 1; services: Service[] };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadata = join(root, '.memory-loop/restart.json');
const lock = join(root, '.memory-loop/restart.lock');
const delay = (ms: number) => new Promise<void>(resolveWait => setTimeout(resolveWait, ms));

function parse(value: unknown): State {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('services' in value) || !Array.isArray(value.services) || !value.services.length) throw new Error('Invalid restart metadata');
  const services: Service[] = [];
  for (const entry of value.services) {
    if (!entry || typeof entry !== 'object' || (entry.kind !== 'web' && entry.kind !== 'daemon') || typeof entry.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.name) ||
        !Number.isSafeInteger(entry.pid) || entry.pid < 1 || typeof entry.startTime !== 'string' || !/^\d+$/.test(entry.startTime) ||
        entry.cwd !== root || typeof entry.executable !== 'string' || !isAbsolute(entry.executable) ||
        typeof entry.transportFile !== 'string' || !isAbsolute(entry.transportFile) || !Array.isArray(entry.args) || !entry.args.every((arg: unknown) => typeof arg === 'string') ||
        entry.args[0] !== '--no-env-file' || entry.args[1] !== join(root, entry.kind === 'web' ? 'src/web/start.ts' : 'backend/runtime.ts')) throw new Error('Invalid managed service metadata');
    services.push({ kind: entry.kind, name: entry.name, pid: entry.pid, startTime: entry.startTime, cwd: entry.cwd, executable: entry.executable, args: entry.args, transportFile: entry.transportFile });
  }
  if (new Set(services.map(service => service.pid)).size !== services.length || new Set(services.map(service => service.name)).size !== services.length || !services.some(service => service.kind === 'web') || !services.some(service => service.kind === 'daemon')) throw new Error('Invalid managed services');
  return { version: 1, services };
}

async function proc(pid: number) {
  const base = `/proc/${pid}`;
  const [stat, cmdline, cwd, executable, environ] = await Promise.all([
    readFile(`${base}/stat`, 'utf8'), readFile(`${base}/cmdline`, 'utf8'), readlink(`${base}/cwd`), realpath(`${base}/exe`), readFile(`${base}/environ`, 'utf8'),
  ]);
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
  return { state: fields[0], startTime: fields[19], args: cmdline.split('\0').filter(Boolean), cwd, executable,
    selector: environ.split('\0').find(item => item.startsWith('MEMORY_LOOP_TRANSPORT_FILE='))?.slice('MEMORY_LOOP_TRANSPORT_FILE='.length) };
}

async function verify(service: Service): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${service.pid}/stat`, 'utf8');
    if (stat.slice(stat.lastIndexOf(') ') + 2).startsWith('Z ')) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    const actual = await proc(service.pid);
    const executable = await realpath(service.executable);
    if (actual.executable !== executable || actual.state === 'Z' || actual.startTime !== service.startTime || actual.cwd !== service.cwd ||
        actual.selector !== service.transportFile || JSON.stringify(actual.args.slice(1)) !== JSON.stringify(service.args)) throw new Error('mismatch');
    return true;
  } catch { throw new Error(`Managed PID ownership check failed: ${service.name}`); }
}

function address(service: Service) {
  const index = service.args.indexOf('--port');
  const portValue = index >= 0 ? service.args[index + 1] : service.args.at(-1);
  if (!portValue || !/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) throw new Error(`Missing service port: ${service.name}`);
  const hostIndex = service.args.indexOf('--hostname');
  const configured = hostIndex >= 0 ? service.args[hostIndex + 1] : '127.0.0.1';
  if (!configured) throw new Error(`Missing service hostname: ${service.name}`);
  const host = configured === '0.0.0.0' ? '127.0.0.1' : configured === '::' ? '::1' : configured;
  return { port: Number(portValue), host };
}
function listening(service: Service): Promise<boolean> {
  const { port, host } = address(service);
  return new Promise(resolveConnection => {
    const socket = createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolveConnection(true); });
    socket.once('error', () => { socket.destroy(); resolveConnection(false); });
    socket.once('timeout', () => { socket.destroy(); resolveConnection(false); });
  });
}
async function stopped(service: Service): Promise<boolean> {
  try { const current = await proc(service.pid); return current.state === 'Z' || current.startTime !== service.startTime; }
  catch { return true; }
}
async function stop(service: Service) {
  if (!await verify(service)) return;
  console.info(`Stopping ${service.name}`);
  process.kill(service.pid, 'SIGTERM');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await stopped(service) && !await listening(service)) return;
    await delay(100);
  }
  throw new Error(`Managed service did not stop: ${service.name}`);
}
async function save(state: State) {
  const temp = `${metadata}.${process.pid}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); await rename(temp, metadata); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
async function start(service: Service, state: State) {
  if (await listening(service)) throw new Error(`Service port is occupied: ${service.name}`);
  console.info(`Starting ${service.name}`);
  const fd = openSync(join(root, '.memory-loop', `restart-${service.name}.log`), 'a', 0o600);
  let child;
  try {
    child = spawn(service.executable, service.args, { cwd: service.cwd, env: { ...process.env, MEMORY_LOOP_TRANSPORT_FILE: service.transportFile }, detached: true, stdio: ['ignore', fd, fd] });
  } finally { closeSync(fd); }
  const pid = child.pid;
  if (!pid) throw new Error(`Could not start ${service.name}`);
  child.unref();
  const identity = await proc(pid);
  service.pid = pid;
  service.startTime = identity.startTime;
  await save(state);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null || await stopped(service)) throw new Error(`Service exited during startup: ${service.name}`);
    if (await listening(service)) return;
    await delay(100);
  }
  throw new Error(`Service did not become ready: ${service.name}`);
}

async function main() {
  const guard = await open(lock, 'wx', 0o600);
  try {
    const state = parse(JSON.parse(await readFile(metadata, 'utf8')));
    for (const service of state.services) { address(service); await verify(service); }
    for (const service of state.services.filter(item => item.kind === 'web')) await stop(service);
    console.info('Building application');
    const build = spawnSync(process.execPath, ['--no-env-file', 'run', 'build'], { cwd: root, env: process.env, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('Build failed; app was not restarted');
    for (const service of state.services.filter(item => item.kind === 'daemon')) await stop(service);
    for (const service of state.services.filter(item => item.kind === 'daemon')) await start(service, state);
    for (const service of state.services.filter(item => item.kind === 'web')) await start(service, state);
    console.info('Restart complete');
  } finally { await guard.close(); await unlink(lock); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Restart failed'); process.exitCode = 1; });
