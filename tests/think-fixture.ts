import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { access, cp, lstat, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { prepareIsolatedLaunch, type Inspect } from './opencode/isolation';
import { preflightExecutable } from './opencode/native-binary';
import { readinessFromOutput } from './opencode/readiness';

const project = fileURLToPath(new URL('..', import.meta.url));
export const fixtureLargeResponse = `fixture-large-response:${'漢🧠'.repeat(30000)}`;
const forbidden = new Set([3000, 3001, 9443, 4173, 4317, 48763]);
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

class FixtureStartupError extends Error {}

function daemonReadiness(port: number, token: string, timeout: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/vault/tree', method: 'GET',
      headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeout) }, response => {
      const status = response.statusCode;
      response.destroy();
      if (status === undefined) reject(new Error('missing status'));
      else resolve(status);
    });
    req.once('error', reject);
    req.end();
  });
}

async function findNode(): Promise<string> {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    try {
      const candidate = await realpath(join(directory, 'node'));
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next PATH entry. */ }
  }
  throw new Error('node executable unavailable');
}

async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

const inspect: Inspect = async path => {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'error';
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error'; }
};

async function freePort(): Promise<number> {
  for (;;) {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (address && typeof address !== 'string' && !forbidden.has(address.port)) return address.port;
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit').catch(() => undefined);
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  try { await bounded(exit, 3000, 'process shutdown'); } catch {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await bounded(exit, 3000, 'process kill');
  }
}

export interface ThinkFixture {
  webUrl: string;
  daemonUrl: string;
  root: string;
  workspace: string;
  credentialFile: string;
  skillIdsBeforeThink?: string[];
  headers: Record<string, string>;
  control: { release(): void; info(): { requests: number; held: number }; generation(): { forced: number; toolResults: number; advertised: string[][] } };
  restartDaemon(): Promise<{ previousPid: number; pid: number }>;
  close(): Promise<void>;
}

export async function launchThinkFixture(options: { binary: string; generationProbe?: { gatewayUrl: string }; projectSkills?: boolean }): Promise<ThinkFixture> {
  if (options.generationProbe) {
    const target = new URL(options.generationProbe.gatewayUrl);
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.pathname !== '/probe' || target.search || target.hash || target.username || target.password || forbidden.has(Number(target.port))) throw new Error('invalid owned gateway fixture');
  }
  await preflightExecutable(options.binary);
  if (await inspect('/etc/opencode') !== 'missing') throw new Error('system OpenCode configuration is not definitely absent');
  if (await realpath('/tmp/opencode') !== '/tmp/opencode' || await inspect('/tmp/opencode') !== 'directory') throw new Error('invalid fixture anchor');
  if (options.projectSkills) {
    // Project discovery walks every ancestor, so reject host configuration before enabling it.
    for (const parent of ['/tmp/opencode', '/tmp', '/']) {
      for (const name of ['opencode.json', 'opencode.jsonc', '.opencode', '.agents', '.claude']) {
        if (await inspect(join(parent, name)) !== 'missing') throw new Error('project skill fixture ancestor configuration is not definitely absent');
      }
    }
  }
  const root = await mkdtemp('/tmp/opencode/think-fixture-');
  const children: ChildProcess[] = [];
  const receipts: Array<{ operation: string; pid: number }> = [];
  const held = new Set<() => void>();
  let requests = 0;
  let generationForced = 0; let generationToolResults = 0; const generationAdvertised: string[][] = [];
  let closing: Promise<void> | undefined;
  let restarting: Promise<{ previousPid: number; pid: number }> | undefined;
  let interrupted = false;
  const provider = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > 4_000_000) request.destroy(); });
    request.on('end', () => {
      let parsed: { model?: string; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> };
      try { parsed = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
      if (parsed.model !== 'fixture-model' || !Array.isArray(parsed.messages)) { response.writeHead(400).end(); return; }
      requests++;
      const user = parsed.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join(' ');
      const toolResult = parsed.messages.some(message => message.role === 'tool');
      const generatedQuote = !!options.generationProbe && /\bquotes?\b/i.test(user) && /attribution/i.test(user);
      const generatedQuestion = !!options.generationProbe && !generatedQuote && /\bquestions?\b/i.test(user) && /JSON array/i.test(user);
      const titleRequest = parsed.messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith('You name conversations'));
      const finish = (delta: object, reason: string) => {
        if (response.destroyed || response.writableEnded) return;
        const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
        const base = { id: 'fixture-completion', object: 'chat.completion.chunk', created: 1, model: 'fixture-model' };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(frame({ ...base, choices: [{ index: 0, delta, finish_reason: null }] }));
        response.write(frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: reason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        response.end('data: [DONE]\n\n');
      };
      const send = () => {
        held.delete(send);
        if (generatedQuote && !titleRequest) {
          finish({ content: JSON.stringify([{ text: 'Fictional fixture words illuminate a path.', attribution: 'Fixture author' }]) }, 'stop');
        }
        else if (generatedQuestion && !titleRequest && options.generationProbe) {
          generationAdvertised.push((parsed.tools ?? []).flatMap(tool => typeof tool.function?.name === 'string' ? [tool.function.name] : []));
          if (!toolResult) {
            generationForced++;
            finish({ tool_calls: [{ index: 0, id: 'fixture-generation-execute', type: 'function', function: { name: 'execute', arguments: JSON.stringify({ code: `const response = await fetch(${JSON.stringify(options.generationProbe.gatewayUrl)}); return await response.text();` }) } }] }, 'tool_calls');
          } else { generationToolResults++; finish({ content: JSON.stringify([{ text: 'Which owned fixture idea is worth exploring?' }]) }, 'stop'); }
        }
        else if (user.includes('fixture-read') && !toolResult) finish({ tool_calls: [{ index: 0, id: 'fixture-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: join(root, 'owned-external/sentinel.env') }) } }] }, 'tool_calls');
        else finish({ content: toolResult ? 'fixture-read-complete' : user.includes('fixture-large') ? fixtureLargeResponse : 'fixture-ok' }, 'stop');
      };
      if (user.includes('fixture-hold') || user.includes('fixture-stop')) { held.add(send); response.once('close', () => held.delete(send)); }
      else send();
    });
  });
  const close = () => closing ??= (async () => {
    held.forEach(release => release());
    // A concurrent intentional restart must settle before taking the final owned-child set.
    await restarting?.catch(() => {});
    let failed = false;
    for (const child of [...children].reverse()) {
      try { await stop(child); } catch { failed = true; }
    }
    provider.closeAllConnections();
    if (provider.listening) await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    if (failed) throw new Error('fixture process cleanup failed');
    await rm(root, { recursive: true, force: true });
  })();
  const interruptStartup = () => { interrupted = true; void close().catch(() => { process.exitCode = 1; }); };
  process.on('SIGINT', interruptStartup);
  process.on('SIGTERM', interruptStartup);
  const start = (operation: string, command: string, args: string[], cwd: string, env: Record<string, string>) => {
    if (interrupted || closing) throw new Error('fixture startup interrupted or closed');
    const child = spawn(command, args, { cwd, env: env as NodeJS.ProcessEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    if (child.pid !== undefined) receipts.push({ operation, pid: child.pid });
    child.on('error', () => undefined);
    return child;
  };
  try {
    for (const name of ['home', 'xdg-config', 'data', 'cache', 'state', 'tmp', 'config', 'db', 'workspace', 'owned-external', 'daemon-app']) await mkdir(join(root, name), { mode: 0o700 });
    await writeFile(join(root, 'empty.gitconfig'), '', { mode: 0o600, flag: 'wx' });
    await writeFile(join(root, 'owned-external/sentinel.env'), 'fixture-read-ok', { mode: 0o600, flag: 'wx' });
    provider.listen(0, '127.0.0.1');
    await bounded(once(provider, 'listening'), 5000, 'provider startup');
    const address = provider.address();
    if (!address || typeof address === 'string' || forbidden.has(address.port)) throw new Error('invalid provider port');
    const origin = `http://127.0.0.1:${address.port}`;
    const password = randomBytes(24).toString('hex');
    const workspace = join(root, 'workspace');
    if (options.projectSkills) {
      await mkdir(join(workspace, '.opencode/skills/fixture-user-skill'), { recursive: true });
      await writeFile(join(workspace, '.opencode/skills/fixture-user-skill/SKILL.md'), '---\nname: fixture-user-skill\ndescription: A user-owned fixture skill.\n---\n\nKeep this fixture untouched.\n', { flag: 'wx' });
      await writeFile(join(workspace, '.opencode/opencode.json'), '{"snapshots":false}\n', { flag: 'wx' });
    }
    const paths = { HOME: join(root, 'home'), OPENCODE_TEST_HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'xdg-config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: join(root, 'tmp'), OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_DB: join(root, 'db/opencode.db'), GIT_CONFIG_GLOBAL: join(root, 'empty.gitconfig') };
    const config = JSON.stringify({ model: 'fixture-provider/fixture-model', update: 'disable', share: 'disabled', snapshots: false, providers: { 'fixture-provider': { env: [], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${origin}/v1`, apiKey: 'fixture-only' }, models: { 'fixture-model': { type: 'chat', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 131072, output: 2048 } } } } } });
    const spec = await prepareIsolatedLaunch({ root, cwd: workspace, paths, config, providerOrigin: origin, password, host: '127.0.0.1', port: 0, hostEnvironment: { OPENCODE_TEST_BINARY: options.binary } }, inspect);
    if (options.projectSkills) {
      delete spec.env.OPENCODE_CONFIG_PROJECT_DISABLE;
      delete spec.env.OPENCODE_DISABLE_FILEWATCHER;
    }
    const version = start('version', spec.executable, ['--version'], spec.cwd, spec.env);
    let versionOutput = '';
    const collectVersion = (chunk: Buffer) => { versionOutput += chunk.toString(); if (versionOutput.length > 4096) version.kill('SIGKILL'); };
    version.stdout?.on('data', collectVersion); version.stderr?.on('data', collectVersion);
    const [versionCode] = await bounded(once(version, 'close'), 5000, 'native version');
    if (versionCode !== 0 || versionOutput.trim() !== 'opencode v2.2.2') throw new Error('native binary version mismatch');
    const native = start('native', spec.executable, spec.args, spec.cwd, spec.env);
    let output = '';
    const url = await bounded(new Promise<string>((resolve, reject) => {
      const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-65536); const value = readinessFromOutput(output); if (value) resolve(value); };
      native.stdout?.on('data', collect); native.stderr?.on('data', collect);
      native.once('exit', () => reject(new Error('native exited before readiness'))); native.once('error', reject);
    }), 30000, 'native startup');
    const client = OpenCode.make({ baseUrl: url, headers: Service.headers({ url, auth: { type: 'basic', username: 'opencode', password } }) });
    const info = await client.server.info({ signal: AbortSignal.timeout(10000) });
    const tmp = relative(root, info.paths.tmp);
    if (info.pid !== native.pid || info.version !== '2.2.2' || !tmp || tmp.startsWith('..') || tmp.startsWith('/')) throw new Error('native identity mismatch');
    const models = await client.model.list({ location: { directory: workspace }, types: ['chat'] }, { signal: AbortSignal.timeout(10000) });
    const enabled = models.data.filter(model => model.enabled && model.type === 'chat');
    const selected = await client.model.default({ location: { directory: workspace } }, { signal: AbortSignal.timeout(10000) });
    if (enabled.length !== 1 || enabled[0].providerID !== 'fixture-provider' || enabled[0].id !== 'fixture-model' || selected.data?.providerID !== 'fixture-provider' || selected.data.id !== 'fixture-model') throw new Error('unexpected fixture model catalog');
    const skillIdsBeforeThink = options.projectSkills
      ? (await client.skill.list({ location: { directory: workspace } }, { signal: AbortSignal.timeout(10000) })).data.map(skill => skill.id)
      : undefined;
    const descriptor = join(root, 'service-discovery.json');
    await writeFile(descriptor, JSON.stringify({ url, pid: info.pid, version: info.version, password }), { mode: 0o600, flag: 'wx' });
    const daemonPort = await freePort();
    let webPort = await freePort();
    while (webPort === daemonPort) webPort = await freePort();
    const daemonUrl = `http://127.0.0.1:${daemonPort}`;
    const webUrl = `http://127.0.0.1:${webPort}`;
    const metadata = join(root, 'daemon-app/.memory-loop');
    await mkdir(metadata, { mode: 0o700 });
    const token = randomBytes(32).toString('hex');
    const credentialFile = join(metadata, 'service.token');
    await writeFile(credentialFile, token, { mode: 0o600, flag: 'wx' });
    const transportFile = join(metadata, 'transport.json');
    await writeFile(transportFile, JSON.stringify({ daemonOrigin: daemonUrl, web: { mode: 'loopback', origin: webUrl } }), { mode: 0o600, flag: 'wx' });
    await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: workspace, think: { service: { registrationFile: descriptor, requiredVersion: '2.2.2' }, location: { kind: 'vault' }, permissionMode: 'full', model: { providerID: 'fixture-provider', id: 'fixture-model' } },
      ...(options.generationProbe ? { ground: { generation: { enabled: true, timeZone: 'UTC', questions: { schedule: '0 6 * * *', count: 2 } } } } : {}) }), { mode: 0o600, flag: 'wx' });
    const copy = join(root, 'project');
    await mkdir(copy, { mode: 0o700 });
    for (const name of ['src', 'backend', 'public', 'package.json', 'tsconfig.json', 'next.config.ts', 'bunfig.toml']) await cp(join(project, name), join(copy, name), { recursive: true });
    await symlink(join(project, 'node_modules'), join(copy, 'node_modules'), 'dir');
    const node = await findNode();
    const env = { HOME: paths.HOME, TMPDIR: paths.TMPDIR, PATH: `${dirname(node)}:/usr/bin:/bin`, MEMORY_LOOP_TRANSPORT_FILE: transportFile, NEXT_TELEMETRY_DISABLED: '1' };
    const build = start('build', node, [join(copy, 'node_modules/next/dist/bin/next'), 'build', copy, '--webpack'], copy, env);
    build.stdout?.resume(); build.stderr?.resume();
    const [buildCode] = await bounded(once(build, 'close'), 120000, 'Next build');
    if (buildCode !== 0) throw new Error('fixture Next build failed');
    const daemonArgs = ['--no-env-file', join(copy, 'backend/runtime.ts'), '--project-root', join(root, 'daemon-app'), '--port', String(daemonPort)];
    const startDaemon = () => {
      const child = start('daemon', '/usr/bin/bun', daemonArgs, copy, env);
      child.stdout?.resume(); child.stderr?.resume();
      return child;
    };
    let daemon = startDaemon();
    const web = start('web', '/usr/bin/bun', ['--no-env-file', join(copy, 'src/web/start.ts'), 'start', '--port', String(webPort)], copy, env);
    web.stdout?.resume(); web.stderr?.resume();
    const deadline = Date.now() + 30000;
    let webStatus: number | 'unavailable' = 'unavailable';
    let daemonStatus: number | 'unavailable' = 'unavailable';
    const diagnostic = () => `web=${webStatus} daemon=${daemonStatus} webExit=${web.exitCode ?? web.signalCode ?? 'running'} daemonExit=${daemon.exitCode ?? daemon.signalCode ?? 'running'}`;
    while (true) {
      if (daemon.exitCode !== null || daemon.signalCode !== null || web.exitCode !== null || web.signalCode !== null) throw new FixtureStartupError(`fixture application exited during startup (${diagnostic()})`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new FixtureStartupError(`fixture application startup timed out (${diagnostic()})`);
      const timeout = Math.min(1000, remaining);
      [webStatus, daemonStatus] = await Promise.all([
        fetch(webUrl, { signal: AbortSignal.timeout(timeout) }).then(response => { void response.body?.cancel().catch(() => undefined); return response.status; }).catch(() => 'unavailable' as const),
        daemonReadiness(daemonPort, token, timeout).catch(() => 'unavailable' as const),
      ]);
      if (webStatus !== 'unavailable' && webStatus < 500 && daemonStatus !== 'unavailable' && daemonStatus >= 200 && daemonStatus < 300) break;
      if (Date.now() >= deadline) throw new FixtureStartupError(`fixture application startup timed out (${diagnostic()})`);
      await wait(Math.min(100, deadline - Date.now()));
    }
    await writeFile(join(root, 'process-receipts.json'), JSON.stringify(receipts), { mode: 0o600, flag: 'wx' });
    if (interrupted) throw new Error('fixture startup interrupted');
    const restartDaemon = async () => {
      if (closing || interrupted) throw new Error('fixture is closed');
      if (restarting) throw new Error('fixture daemon restart already running');
      const previous = daemon;
      const previousPid = previous.pid;
      if (!previousPid || !children.includes(previous) || !receipts.some(item => item.operation === 'daemon' && item.pid === previousPid) ||
          previous.exitCode !== null || previous.signalCode !== null) throw new Error('owned fixture daemon unavailable');
      const work = (async () => {
        await stop(previous);
        if (closing || interrupted) throw new Error('fixture is closed');
        // Same source copy, project root, transport, credential and native registration; no native/web restart.
        daemon = startDaemon();
        await writeFile(join(root, 'process-receipts.json'), JSON.stringify(receipts), { mode: 0o600 });
        const deadline = Date.now() + 30000;
        for (;;) {
          if (closing || interrupted) throw new Error('fixture is closed');
          if (daemon.exitCode !== null || daemon.signalCode !== null || native.exitCode !== null || native.signalCode !== null ||
              web.exitCode !== null || web.signalCode !== null) throw new Error('fixture child exited during daemon restart');
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error('fixture daemon restart timed out');
          const status = await daemonReadiness(daemonPort, token, Math.min(1000, remaining)).catch(() => undefined);
          if (status === 200) break;
          await wait(Math.min(100, Math.max(0, deadline - Date.now())));
        }
        if (!daemon.pid) throw new Error('fixture daemon missing process identity');
        return { previousPid, pid: daemon.pid };
      })();
      restarting = work;
      try { return await work; } finally { restarting = undefined; }
    };
    return { webUrl, daemonUrl, root, workspace, credentialFile, skillIdsBeforeThink, headers: { authorization: `Bearer ${token}`, host: `127.0.0.1:${daemonPort}` }, control: { release: () => held.forEach(release => release()), info: () => ({ requests, held: held.size }), generation: () => ({ forced: generationForced, toolResults: generationToolResults, advertised: generationAdvertised.map(names => [...names]) }) }, restartDaemon, close };
  } catch (error) { await close(); throw error; }
  finally { process.removeListener('SIGINT', interruptStartup); process.removeListener('SIGTERM', interruptStartup); }
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) {
    console.log('Local Think fixture: set OPENCODE_TEST_BINARY to the absolute pinned OpenCode 2.2.2 executable, then run bun --no-env-file run think:fixture.');
    return;
  }
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary) throw new Error('OPENCODE_TEST_BINARY selector is required');
  const fixture = await launchThinkFixture({ binary });
  console.log(`Fixture web URL: ${fixture.webUrl}\nTry: curl '${fixture.webUrl}/api/think/conversations/<conversation-id>'\nPress Ctrl-C to clean up.`);
  const shutdown = () => { void fixture.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

if (import.meta.main) main().catch((error: unknown) => { console.error(error instanceof FixtureStartupError ? error.message : 'Fixture startup failed: invalid binary selector or fixture setup'); process.exitCode = 1; });
